// 初始化页面时连接到后端初始化API
document.addEventListener('DOMContentLoaded', function() {
    fetch('/initialize')
        .then(response => response.json())
        .then(data => {
            console.log('System initialized with thread ID:', data.thread_id);
            console.log('Using Character Writer Assistant:', data.character_writer_assistant_id);
            console.log('Using Character Editor Assistant:', data.character_editor_assistant_id);
        })
        .catch(error => {
            console.error('初始化失败:', error);
            document.getElementById('submit-storyline').disabled = true;
            alert('系统初始化失败，请刷新页面重试');
        });
});

// 处理故事线提交
document.getElementById('submit-storyline').addEventListener('click', function() {
    const storyline = document.getElementById('preliminary-storyline').value;
    if (!storyline.trim()) {
        alert('请先输入初步故事线');
        return;
    }
    
    // 更新UI状态
    document.getElementById('submit-storyline').disabled = true;
    document.getElementById('current-stage').textContent = '角色设计';
    
    // 切换到角色设计阶段
    document.getElementById('stage-1').classList.remove('active');
    document.getElementById('stage-1').classList.add('completed');
    document.getElementById('stage-1').classList.add('hidden');
    
    document.getElementById('stage-2').classList.remove('hidden');
    document.getElementById('stage-2').classList.add('active');
    
    document.getElementById('step-1').classList.remove('active');
    document.getElementById('step-2').classList.add('active');
    
    document.getElementById('character-design-status').textContent = '生成中...';
    
    // 初始化输出区域
    const outputElement = document.getElementById('character-design-output');
    outputElement.textContent = '';
    
    // 提交故事线并获取任务ID
    fetch('/api/generate_characters', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ storyline: storyline }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            // 获取任务ID后，创建EventSource来监听任务进度
            const taskId = data.task_id;
            const eventSource = new EventSource(`/api/tasks/${taskId}/stream`);
            
            // 处理事件流
            eventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                
                if (data.status === 'streaming') {
                    // 添加内容到输出区域（模拟打字效果）
                    outputElement.textContent += data.content;
                } 
                else if (data.status === 'complete') {
                    // 更新UI状态
                    document.getElementById('character-design-status').textContent = '已完成';
                    document.getElementById('proceed-to-review').disabled = false;
                    
                    // 关闭事件流
                    eventSource.close();
                }
                else if (data.status === 'error') {
                    // 显示错误信息
                    outputElement.textContent += `\n错误: ${data.message}`;
                    document.getElementById('character-design-status').textContent = '发生错误';
                    
                    // 关闭事件流
                    eventSource.close();
                }
            };
            
            // 处理错误
            eventSource.onerror = function(error) {
                console.error('EventSource failed:', error);
                outputElement.textContent += '\n连接错误，请刷新页面重试';
                document.getElementById('character-design-status').textContent = '连接错误';
                eventSource.close();
            };
        } else {
            // 处理错误
            outputElement.textContent = data.error || '处理请求时发生错误';
            document.getElementById('character-design-status').textContent = '请求错误';
        }
    })
    .catch(error => {
        console.error('Error:', error);
        outputElement.textContent = '处理请求时发生错误';
        document.getElementById('character-design-status').textContent = '请求错误';
    });
});

// 处理开始审阅流程按钮
document.getElementById('start-review-process').addEventListener('click', function() {
    // 禁用按钮
    document.getElementById('start-review-process').disabled = true;
    
    // 清空输出区域
    document.getElementById('editor-advice-output').textContent = '';
    document.getElementById('revised-character-output').textContent = '';
    
    // 更新状态
    document.getElementById('character-review-status').textContent = '审阅中...';
    document.getElementById('iteration-count').textContent = '0';
    
    // 获取最大迭代次数
    const maxIterations = document.getElementById('max-iterations').value;
    
    // 调用API开始审阅流程
    fetch('/api/review_characters', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ max_iterations: parseInt(maxIterations) }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            // 获取任务ID后，创建EventSource来监听任务进度
            const taskId = data.task_id;
            const eventSource = new EventSource(`/api/tasks/${taskId}/stream`);
            
            // 处理事件流
            eventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                
                if (data.status === 'streaming') {
                    // 对于流式输出，我们只显示最新状态
                    document.getElementById('character-review-status').textContent = '数据接收中...';
                } 
                else if (data.status === 'complete') {
                    try {
                        // 解析迭代数据
                        const iterationData = JSON.parse(data.content);
                        
                        // 更新迭代计数
                        if (iterationData && iterationData.length > 0) {
                            const lastIteration = iterationData[iterationData.length - 1];
                            document.getElementById('iteration-count').textContent = lastIteration.iteration;
                            
                            // 清空现有输出区域
                            const editorAdviceOutput = document.getElementById('editor-advice-output');
                            const revisedCharacterOutput = document.getElementById('revised-character-output');
                            editorAdviceOutput.innerHTML = '';
                            revisedCharacterOutput.innerHTML = '';
                            
                            // 显示所有迭代的结果，每轮都完整显示
                            iterationData.forEach((iteration, index) => {
                                // 为每个迭代创建标题
                                const editorHeader = document.createElement('h4');
                                editorHeader.textContent = `第 ${iteration.iteration} 轮编辑反馈`;
                                editorAdviceOutput.appendChild(editorHeader);
                                
                                // 添加编辑器建议
                                const editorAdviceContent = document.createElement('pre');
                                editorAdviceContent.className = 'iteration-content';
                                editorAdviceContent.textContent = iteration.editor_advice;
                                editorAdviceOutput.appendChild(editorAdviceContent);
                                
                                // 创建分隔线
                                const editorDivider = document.createElement('hr');
                                editorAdviceOutput.appendChild(editorDivider);
                                
                                // 为每个迭代创建标题
                                const writerHeader = document.createElement('h4');
                                writerHeader.textContent = `第 ${iteration.iteration} 轮角色修改`;
                                revisedCharacterOutput.appendChild(writerHeader);
                                
                                // 添加修改后的角色
                                const revisedContent = document.createElement('pre');
                                revisedContent.className = 'iteration-content';
                                revisedContent.textContent = iteration.revised_characters;
                                revisedCharacterOutput.appendChild(revisedContent);
                                
                                // 创建分隔线
                                const writerDivider = document.createElement('hr');
                                revisedCharacterOutput.appendChild(writerDivider);
                            });
                        }
                        
                        // 更新UI状态
                        document.getElementById('character-review-status').textContent = data.is_final ? '已完成' : '等待下一轮迭代';
                        document.getElementById('start-review-process').disabled = data.is_final;
                        document.getElementById('proceed-to-outline').disabled = !data.is_final;
                        
                    } catch (e) {
                        console.error("解析迭代数据失败:", e);
                        document.getElementById('character-review-status').textContent = '数据解析错误';
                    }
                    
                    // 关闭事件流
                    eventSource.close();
                }
                else if (data.status === 'error') {
                    // 显示错误信息
                    document.getElementById('editor-advice-output').textContent = `错误: ${data.message}`;
                    document.getElementById('character-review-status').textContent = '发生错误';
                    
                    // 启用重试按钮
                    document.getElementById('start-review-process').disabled = false;
                    
                    // 关闭事件流
                    eventSource.close();
                }
            };
            
            // 处理错误
            eventSource.onerror = function(error) {
                console.error('EventSource failed:', error);
                document.getElementById('editor-advice-output').textContent = '连接错误，请刷新页面重试';
                document.getElementById('character-review-status').textContent = '连接错误';
                
                // 启用重试按钮
                document.getElementById('start-review-process').disabled = false;
                
                eventSource.close();
            };
        } else {
            // 处理错误
            document.getElementById('editor-advice-output').textContent = data.error || '处理请求时发生错误';
            document.getElementById('character-review-status').textContent = '请求错误';
            
            // 启用重试按钮
            document.getElementById('start-review-process').disabled = false;
        }
    })
    .catch(error => {
        console.error('Error:', error);
        document.getElementById('editor-advice-output').textContent = '处理请求时发生错误';
        document.getElementById('character-review-status').textContent = '请求错误';
        
        // 启用重试按钮
        document.getElementById('start-review-process').disabled = false;
    });
});

// 处理进入大纲编写阶段的按钮
document.getElementById('proceed-to-outline').addEventListener('click', function() {
    // 更新UI状态
    document.getElementById('current-stage').textContent = '故事大纲撰写';
    
    // 切换到大纲编写阶段
    document.getElementById('stage-3').classList.remove('active');
    document.getElementById('stage-3').classList.add('completed');
    document.getElementById('stage-3').classList.add('hidden');
    
    document.getElementById('stage-4').classList.remove('hidden');
    document.getElementById('stage-4').classList.add('active');
    
    document.getElementById('step-3').classList.remove('active');
    document.getElementById('step-4').classList.add('active');
    
    // 更新状态文本
    document.getElementById('outline-status').textContent = '等待开始';
});

// 处理大纲生成按钮
document.getElementById('generate-outline').addEventListener('click', function() {
    // 禁用按钮
    document.getElementById('generate-outline').disabled = true;
    
    // 更新状态
    document.getElementById('outline-status').textContent = '生成中...';
    
    // 清空输出区域
    const outputElement = document.getElementById('outline-output');
    outputElement.textContent = '';
    
    // 调用API开始大纲生成
    fetch('/api/generate_outline', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),  // 不需要额外参数，后端已有所需数据
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            // 获取任务ID后，创建EventSource来监听任务进度
            const taskId = data.task_id;
            const eventSource = new EventSource(`/api/tasks/${taskId}/stream`);
            
            // 处理事件流
            eventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                
                if (data.status === 'streaming') {
                    // 添加内容到输出区域（模拟打字效果）
                    outputElement.textContent += data.content;
                } 
                else if (data.status === 'complete') {
                    // 从完整响应中提取大纲
                    const outlineMatch = /<outline>([\s\S]*?)<\/outline>/.exec(data.content);
                    if (outlineMatch) {
                        // 格式化大纲显示
                        formatAndDisplayOutline(outlineMatch[0], outputElement);
                    } else {
                        outputElement.textContent = data.content;
                    }
                    
                    // 更新UI状态
                    document.getElementById('outline-status').textContent = '已完成';
                    document.getElementById('proceed-to-outline-review').disabled = false;
                    
                    // 关闭事件流
                    eventSource.close();
                }
                else if (data.status === 'error') {
                    // 显示错误信息
                    outputElement.textContent += `\n错误: ${data.message}`;
                    document.getElementById('outline-status').textContent = '发生错误';
                    document.getElementById('generate-outline').disabled = false;
                    
                    // 关闭事件流
                    eventSource.close();
                }
            };
            
            // 处理错误
            eventSource.onerror = function(error) {
                console.error('EventSource failed:', error);
                outputElement.textContent += '\n连接错误，请刷新页面重试';
                document.getElementById('outline-status').textContent = '连接错误';
                document.getElementById('generate-outline').disabled = false;
                eventSource.close();
            };
        } else {
            // 处理错误
            outputElement.textContent = data.error || '处理请求时发生错误';
            document.getElementById('outline-status').textContent = '请求错误';
            document.getElementById('generate-outline').disabled = false;
        }
    })
    .catch(error => {
        console.error('Error:', error);
        outputElement.textContent = '处理请求时发生错误';
        document.getElementById('outline-status').textContent = '请求错误';
        document.getElementById('generate-outline').disabled = false;
    });
});

// 格式化并显示大纲
function formatAndDisplayOutline(outlineXml, container) {
    // 先清空容器
    container.innerHTML = '';
    
    // 创建可折叠的大纲结构
    const outlineElement = document.createElement('div');
    outlineElement.className = 'formatted-outline';
    
    // 提取并解析大纲中的各个情节
    const plotRegex = /<plot_(\w+)>([\s\S]*?)<\/plot_\1>/g;
    let plotMatch;
    let plots = [];
    
    // 搜集所有情节
    while ((plotMatch = plotRegex.exec(outlineXml)) !== null) {
        const plotId = plotMatch[1];
        const plotContent = plotMatch[2].trim();
        
        // 提取场景和角色
        const sceneMatch = /<scene>([\s\S]*?)<\/scene>/.exec(plotContent);
        const charactersMatch = /<characters>([\s\S]*?)<\/characters>/.exec(plotContent);
        
        // 获取纯文本内容
        let textContent = plotContent
            .replace(/<scene>[\s\S]*?<\/scene>/, '')
            .replace(/<characters>[\s\S]*?<\/characters>/, '')
            .trim();
        
        plots.push({
            id: plotId,
            isMainPlot: plotId.length === 1 || (!isNaN(plotId) && !plotId.includes('a') && !plotId.includes('b')),
            parentId: plotId.match(/^\d+/) ? plotId.match(/^\d+/)[0] : null, // 提取父情节ID
            content: textContent,
            scene: sceneMatch ? sceneMatch[1].trim() : '',
            characters: charactersMatch ? charactersMatch[1].trim() : ''
        });
    }
    
    // 按照ID排序，确保主情节在前
    plots.sort((a, b) => {
        // 如果有相同的父ID，按完整ID排序
        if (a.parentId === b.parentId) {
            return a.id.localeCompare(b.id, undefined, {numeric: true, sensitivity: 'base'});
        }
        
        // 不同的父ID，主情节优先
        if (a.isMainPlot && !b.isMainPlot) return -1;
        if (!a.isMainPlot && b.isMainPlot) return 1;
        
        // 如果都是主情节或都是子情节，按ID排序
        return a.parentId.localeCompare(b.parentId, undefined, {numeric: true, sensitivity: 'base'});
    });
    
    // 按照主情节分组
    const plotGroups = {};
    plots.forEach(plot => {
        const mainId = plot.isMainPlot ? plot.id : plot.parentId;
        if (!plotGroups[mainId]) {
            plotGroups[mainId] = [];
        }
        plotGroups[mainId].push(plot);
    });
    
    // 按顺序创建每个主情节及其子情节
    Object.keys(plotGroups).sort((a, b) => {
        return a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'});
    }).forEach(mainId => {
        const mainPlotGroup = plotGroups[mainId];
        
        // 先找出并创建主情节
        const mainPlot = mainPlotGroup.find(p => p.isMainPlot);
        if (mainPlot) {
            // 创建主情节元素
            const mainPlotElement = document.createElement('div');
            mainPlotElement.className = 'main-plot';
            
            // 创建主情节标题
            const titleElement = document.createElement('h4');
            titleElement.textContent = `主情节 ${mainPlot.id}`;
            mainPlotElement.appendChild(titleElement);
            
            // 创建主情节内容
            const contentElement = document.createElement('p');
            contentElement.textContent = mainPlot.content;
            mainPlotElement.appendChild(contentElement);
            
            // 如果有场景信息，添加场景
            if (mainPlot.scene) {
                const sceneElement = document.createElement('div');
                sceneElement.className = 'plot-scene';
                sceneElement.innerHTML = `<strong>场景:</strong> ${mainPlot.scene}`;
                mainPlotElement.appendChild(sceneElement);
            }
            
            // 如果有角色信息，添加角色
            if (mainPlot.characters) {
                const charactersElement = document.createElement('div');
                charactersElement.className = 'plot-characters';
                charactersElement.innerHTML = `<strong>角色:</strong> ${mainPlot.characters}`;
                mainPlotElement.appendChild(charactersElement);
            }
            
            // 添加到大纲容器
            outlineElement.appendChild(mainPlotElement);
            
            // 然后添加所有属于这个主情节的子情节
            mainPlotGroup.filter(p => !p.isMainPlot).forEach(subPlot => {
                const subPlotElement = document.createElement('div');
                subPlotElement.className = 'sub-plot';
                
                // 创建子情节标题
                const subTitleElement = document.createElement('h4');
                subTitleElement.textContent = `子情节 ${subPlot.id}`;
                subPlotElement.appendChild(subTitleElement);
                
                // 创建子情节内容
                const subContentElement = document.createElement('p');
                subContentElement.textContent = subPlot.content;
                subPlotElement.appendChild(subContentElement);
                
                // 如果有场景信息，添加场景
                if (subPlot.scene) {
                    const subSceneElement = document.createElement('div');
                    subSceneElement.className = 'plot-scene';
                    subSceneElement.innerHTML = `<strong>场景:</strong> ${subPlot.scene}`;
                    subPlotElement.appendChild(subSceneElement);
                }
                
                // 如果有角色信息，添加角色
                if (subPlot.characters) {
                    const subCharactersElement = document.createElement('div');
                    subCharactersElement.className = 'plot-characters';
                    subCharactersElement.innerHTML = `<strong>角色:</strong> ${subPlot.characters}`;
                    subPlotElement.appendChild(subCharactersElement);
                }
                
                // 添加到大纲容器
                outlineElement.appendChild(subPlotElement);
            });
        }
    });
    
    // 将格式化后的大纲添加到容器
    container.appendChild(outlineElement);
    
    // 同时保留原始XML作为隐藏元素
    const rawElement = document.createElement('pre');
    rawElement.className = 'raw-outline hidden';
    rawElement.textContent = outlineXml;
    container.appendChild(rawElement);
}

// 处理进入大纲审阅阶段的按钮
document.getElementById('proceed-to-outline-review').addEventListener('click', function() {
    alert('大纲已完成！大纲审阅功能将在下一阶段实现。');
});

// 处理进入审阅阶段的按钮
document.getElementById('proceed-to-review').addEventListener('click', function() {
    // 更新UI状态
    document.getElementById('current-stage').textContent = '角色审阅与反馈';
    
    // 切换到审阅阶段
    document.getElementById('stage-2').classList.remove('active');
    document.getElementById('stage-2').classList.add('completed');
    document.getElementById('stage-2').classList.add('hidden');
    
    document.getElementById('stage-3').classList.remove('hidden');
    document.getElementById('stage-3').classList.add('active');
    
    document.getElementById('step-2').classList.remove('active');
    document.getElementById('step-3').classList.add('active');
    
    // 更新状态文本
    document.getElementById('character-review-status').textContent = '等待开始';
    
    // 启用审阅流程开始按钮
    document.getElementById('start-review-process').disabled = false;
}); 