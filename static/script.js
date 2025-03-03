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

// 处理角色设计生成后，点击"提交角色设计进行审阅"按钮
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
            isMainPlot: plotId.length === 1 || !isNaN(plotId),
            content: textContent,
            scene: sceneMatch ? sceneMatch[1].trim() : '',
            characters: charactersMatch ? charactersMatch[1].trim() : ''
        });
    }
    
    // 按照ID排序，确保主情节在前，子情节按顺序排列
    plots.sort((a, b) => {
        // 先比较是否是主情节
        if (a.isMainPlot && !b.isMainPlot) return -1;
        if (!a.isMainPlot && b.isMainPlot) return 1;
        
        // 如果都是主情节或都是子情节，按ID排序
        return a.id.localeCompare(b.id, undefined, {numeric: true, sensitivity: 'base'});
    });
    
    // 创建大纲元素
    plots.forEach(plot => {
        const plotElement = document.createElement('div');
        plotElement.className = plot.isMainPlot ? 'main-plot' : 'sub-plot';
        
        // 创建标题
        const titleElement = document.createElement('h4');
        titleElement.textContent = plot.isMainPlot 
            ? `主情节 ${plot.id}` 
            : `子情节 ${plot.id}`;
        plotElement.appendChild(titleElement);
        
        // 创建内容
        const contentElement = document.createElement('p');
        contentElement.textContent = plot.content;
        plotElement.appendChild(contentElement);
        
        // 如果有场景信息，添加场景
        if (plot.scene) {
            const sceneElement = document.createElement('div');
            sceneElement.className = 'plot-scene';
            sceneElement.innerHTML = `<strong>场景:</strong> ${plot.scene}`;
            plotElement.appendChild(sceneElement);
        }
        
        // 如果有角色信息，添加角色
        if (plot.characters) {
            const charactersElement = document.createElement('div');
            charactersElement.className = 'plot-characters';
            charactersElement.innerHTML = `<strong>角色:</strong> ${plot.characters}`;
            plotElement.appendChild(charactersElement);
        }
        
        // 添加到大纲容器
        outlineElement.appendChild(plotElement);
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
    // 更新UI状态
    document.getElementById('current-stage').textContent = '大纲审阅与反馈';
    
    // 切换到大纲审阅阶段
    document.getElementById('stage-4').classList.remove('active');
    document.getElementById('stage-4').classList.add('completed');
    document.getElementById('stage-4').classList.add('hidden');
    
    document.getElementById('stage-5').classList.remove('hidden');
    document.getElementById('stage-5').classList.add('active');
    
    document.getElementById('step-4').classList.remove('active');
    document.getElementById('step-5').classList.add('active');
    
    // 更新状态文本
    document.getElementById('outline-review-status').textContent = '等待开始';
    
    // 启用审阅流程开始按钮
    document.getElementById('start-outline-review-process').disabled = false;
});

// 处理开始大纲审阅流程按钮
document.getElementById('start-outline-review-process').addEventListener('click', function() {
    // 禁用按钮
    document.getElementById('start-outline-review-process').disabled = true;
    
    // 清空输出区域
    document.getElementById('outline-editor-advice-output').textContent = '';
    document.getElementById('revised-outline-output').textContent = '';
    
    // 更新状态
    document.getElementById('outline-review-status').textContent = '审阅中...';
    document.getElementById('iteration-count').textContent = '0';
    
    // 获取最大迭代次数
    const maxIterations = document.getElementById('max-iterations').value;
    
    // 调用API开始大纲审阅流程
    fetch('/api/review_outline', {
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
                    document.getElementById('outline-review-status').textContent = '数据接收中...';
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
                            const editorAdviceOutput = document.getElementById('outline-editor-advice-output');
                            const revisedOutlineOutput = document.getElementById('revised-outline-output');
                            editorAdviceOutput.innerHTML = '';
                            revisedOutlineOutput.innerHTML = '';
                            
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
                                writerHeader.textContent = `第 ${iteration.iteration} 轮大纲修改`;
                                revisedOutlineOutput.appendChild(writerHeader);
                                
                                // 从修改后的大纲中提取并格式化显示
                                const outlineMatch = /<outline>([\s\S]*?)<\/outline>/.exec(iteration.revised_outline);
                                if (outlineMatch) {
                                    const outlineContainer = document.createElement('div');
                                    formatAndDisplayOutline(outlineMatch[0], outlineContainer);
                                    revisedOutlineOutput.appendChild(outlineContainer);
                                } else {
                                    // 如果无法提取大纲，显示原始内容
                                    const revisedContent = document.createElement('pre');
                                    revisedContent.className = 'iteration-content';
                                    revisedContent.textContent = iteration.revised_outline;
                                    revisedOutlineOutput.appendChild(revisedContent);
                                }
                                
                                // 创建分隔线
                                const writerDivider = document.createElement('hr');
                                revisedOutlineOutput.appendChild(writerDivider);
                            });
                        }
                        
                        // 更新UI状态
                        document.getElementById('outline-review-status').textContent = data.is_final ? '已完成' : '等待下一轮迭代';
                        document.getElementById('start-outline-review-process').disabled = data.is_final;
                        document.getElementById('proceed-to-scene-expansion').disabled = !data.is_final;
                        
                    } catch (e) {
                        console.error("解析迭代数据失败:", e);
                        document.getElementById('outline-review-status').textContent = '数据解析错误';
                    }
                    
                    // 关闭事件流
                    eventSource.close();
                }
                else if (data.status === 'error') {
                    // 显示错误信息
                    document.getElementById('outline-editor-advice-output').textContent = `错误: ${data.message}`;
                    document.getElementById('outline-review-status').textContent = '发生错误';
                    
                    // 启用重试按钮
                    document.getElementById('start-outline-review-process').disabled = false;
                    
                    // 关闭事件流
                    eventSource.close();
                }
            };
            
            // 处理错误
            eventSource.onerror = function(error) {
                console.error('EventSource failed:', error);
                document.getElementById('outline-editor-advice-output').textContent = '连接错误，请刷新页面重试';
                document.getElementById('outline-review-status').textContent = '连接错误';
                
                // 启用重试按钮
                document.getElementById('start-outline-review-process').disabled = false;
                
                eventSource.close();
            };
        } else {
            // 处理错误
            document.getElementById('outline-editor-advice-output').textContent = data.error || '处理请求时发生错误';
            document.getElementById('outline-review-status').textContent = '请求错误';
            
            // 启用重试按钮
            document.getElementById('start-outline-review-process').disabled = false;
        }
    })
    .catch(error => {
        console.error('Error:', error);
        document.getElementById('outline-editor-advice-output').textContent = '处理请求时发生错误';
        document.getElementById('outline-review-status').textContent = '请求错误';
        
        // 启用重试按钮
        document.getElementById('start-outline-review-process').disabled = false;
    });
});

// 处理进入场景扩写阶段的按钮
document.getElementById('proceed-to-scene-expansion').addEventListener('click', function() {
    // 更新UI状态
    document.getElementById('current-stage').textContent = '子情节扩写';
    
    // 切换到情节扩写阶段
    document.getElementById('stage-5').classList.remove('active');
    document.getElementById('stage-5').classList.add('completed');
    document.getElementById('stage-5').classList.add('hidden');
    
    document.getElementById('stage-6').classList.remove('hidden');
    document.getElementById('stage-6').classList.add('active');
    
    document.getElementById('step-5').classList.remove('active');
    document.getElementById('step-6').classList.add('active');
    
    // 更新状态文本
    document.getElementById('story-expansion-status').textContent = '等待开始';
    
    // 启用扩写按钮
    document.getElementById('expand-story').disabled = false;
});

// 处理开始扩写情节按钮
document.getElementById('expand-story').addEventListener('click', function() {
    // 禁用按钮
    document.getElementById('expand-story').disabled = true;
    
    // 清空章节选择器和内容区域
    const chapterSelector = document.getElementById('chapter-selector');
    chapterSelector.innerHTML = '<option value="">选择章节...</option>';
    document.getElementById('chapter-content').textContent = '';
    
    // 禁用导航按钮
    document.getElementById('prev-chapter').disabled = true;
    document.getElementById('next-chapter').disabled = true;
    
    // 更新状态
    document.getElementById('story-expansion-status').textContent = '扩写中...';
    document.getElementById('progress-text').textContent = '0 / 0 情节已完成';
    document.getElementById('progress-bar').style.width = '0%';
    
    let chapters = [];
    let currentChapterIndex = 0;
    
    // 调用API开始情节扩写
    fetch('/api/expand_story', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
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
                    // 正在进行中的状态更新
                    document.getElementById('story-expansion-status').textContent = '正在扩写...';
                } 
                else if (data.status === 'complete') {
                    try {
                        // 解析章节数据
                        const chapterData = JSON.parse(data.content);
                        
                        if (chapterData.progress) {
                            // 更新进度条
                            const progress = chapterData.progress;
                            document.getElementById('progress-text').textContent = 
                                `${progress.current} / ${progress.total} 情节已完成`;
                            document.getElementById('progress-bar').style.width = 
                                `${(progress.current / progress.total) * 100}%`;
                            
                            // 显示当前章节内容
                            if (chapterData.chapter_content) {
                                const chapterHtml = formatChapterContent(chapterData.chapter_content);
                                document.getElementById('chapter-content').innerHTML = chapterHtml;
                            }
                        }
                        
                        // 章节已完成，更新界面
                        if (data.is_final && chapterData.chapters) {
                            chapters = chapterData.chapters;
                            
                            // 更新章节选择器
                            chapters.forEach((chapter, index) => {
                                const option = document.createElement('option');
                                option.value = index;
                                option.textContent = `情节 ${chapter.plot_id}`;
                                chapterSelector.appendChild(option);
                            });
                            
                            // 启用章节导航
                            document.getElementById('chapter-selector').disabled = false;
                            document.getElementById('prev-chapter').disabled = chapters.length <= 1;
                            document.getElementById('next-chapter').disabled = chapters.length <= 1;
                            document.getElementById('proceed-to-draft').disabled = false;
                            
                            // 显示所有章节的最后一章
                            if (chapters.length > 0) {
                                currentChapterIndex = chapters.length - 1;
                                showChapter(currentChapterIndex);
                                chapterSelector.value = currentChapterIndex;
                            }
                            
                            // 更新状态
                            document.getElementById('story-expansion-status').textContent = '已完成';
                        }
                        
                    } catch (e) {
                        console.error("解析章节数据失败:", e);
                        document.getElementById('story-expansion-status').textContent = '数据解析错误';
                    }
                    
                    // 完成任务后关闭事件流
                    if (data.is_final) {
                        eventSource.close();
                    }
                }
                else if (data.status === 'error') {
                    // 显示错误信息
                    document.getElementById('chapter-content').textContent = `错误: ${data.message}`;
                    document.getElementById('story-expansion-status').textContent = '发生错误';
                    
                    // 启用重试按钮
                    document.getElementById('expand-story').disabled = false;
                    
                    // 关闭事件流
                    eventSource.close();
                }
            };
        }
    });
});

// 显示指定索引的章节
function showChapter(index) {
    const chapterSelector = document.getElementById('chapter-selector');
    const chapterContent = document.getElementById('chapter-content');
    
    if (chapterSelector.options.length <= index + 1) return; // +1 是因为第一个选项是"选择章节..."
    
    const option = chapterSelector.options[index + 1];
    if (!option) return;
    
    // 从章节数据中获取内容
    fetch('/api/get_creation_state')
        .then(response => response.json())
        .then(state => {
            if (state.story_chapters && state.story_chapters.length > index) {
                const chapterHtml = formatChapterContent(state.story_chapters[index]);
                chapterContent.innerHTML = chapterHtml;
            } else {
                chapterContent.textContent = '无法加载章节内容';
            }
        })
        .catch(error => {
            console.error('Error loading chapter:', error);
            chapterContent.textContent = '加载章节时发生错误';
        });
}

// 格式化章节内容
function formatChapterContent(chapterXml) {
    // 提取<chapter>标签内的内容
    const contentMatch = /<chapter>([\s\S]*?)<\/chapter>/.exec(chapterXml);
    if (!contentMatch) return chapterXml;
    
    // 将内容分段，使其更易读
    const content = contentMatch[1];
    const paragraphs = content.split(/\n\n+/);
    
    return paragraphs.map(p => `<p>${p.trim()}</p>`).join('');
}

// 处理进入剧本草拟阶段的按钮
document.getElementById('proceed-to-draft').addEventListener('click', function() {
    // 更新UI状态
    document.getElementById('current-stage').textContent = '剧本草拟';
    
    // 切换到剧本草拟阶段
    document.getElementById('stage-6').classList.remove('active');
    document.getElementById('stage-6').classList.add('completed');
    document.getElementById('stage-6').classList.add('hidden');
    
    document.getElementById('stage-7').classList.remove('hidden');
    document.getElementById('stage-7').classList.add('active');
    
    document.getElementById('step-6').classList.remove('active');
    document.getElementById('step-7').classList.add('active');
    
    // 更新状态文本
    document.getElementById('script-draft-status').textContent = '等待开始';
    
    // 启用草拟按钮
    document.getElementById('draft-script').disabled = false;
});

// 处理开始草拟剧本按钮
document.getElementById('draft-script').addEventListener('click', function() {
    // 禁用按钮
    document.getElementById('draft-script').disabled = true;
    
    // 清空剧本选择器和内容区域
    const draftSelector = document.getElementById('draft-selector');
    draftSelector.innerHTML = '<option value="">选择剧本段落...</option>';
    document.getElementById('draft-content').textContent = '';
    
    // 禁用导航按钮
    document.getElementById('prev-draft').disabled = true;
    document.getElementById('next-draft').disabled = true;
    
    // 更新状态
    document.getElementById('script-draft-status').textContent = '草拟中...';
    document.getElementById('draft-progress-text').textContent = '0 / 0 章节已完成';
    document.getElementById('draft-progress-bar').style.width = '0%';
    
    let drafts = [];
    let currentDraftIndex = 0;
    
    // 调用API开始剧本草拟
    fetch('/api/draft_script', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
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
                    // 正在进行中的状态更新
                    document.getElementById('script-draft-status').textContent = '正在草拟...';
                } 
                else if (data.status === 'complete') {
                    try {
                        // 解析剧本数据
                        const draftData = JSON.parse(data.content);
                        
                        if (draftData.progress) {
                            // 更新进度条
                            const progress = draftData.progress;
                            document.getElementById('draft-progress-text').textContent = 
                                `${progress.current} / ${progress.total} 章节已完成`;
                            document.getElementById('draft-progress-bar').style.width = 
                                `${(progress.current / progress.total) * 100}%`;
                            
                            // 显示当前剧本内容
                            if (draftData.draft_content) {
                                const draftHtml = formatScriptContent(draftData.draft_content);
                                document.getElementById('draft-content').innerHTML = draftHtml;
                            }
                        }
                        
                        // 剧本已完成，更新界面
                        if (data.is_final && draftData.drafts) {
                            drafts = draftData.drafts;
                            
                            // 更新剧本选择器
                            drafts.forEach((draft, index) => {
                                const option = document.createElement('option');
                                option.value = index;
                                option.textContent = `章节 ${index + 1}: ${draft.plot_id}`;
                                draftSelector.appendChild(option);
                            });
                            
                            // 启用剧本导航
                            document.getElementById('draft-selector').disabled = false;
                            document.getElementById('prev-draft').disabled = drafts.length <= 1;
                            document.getElementById('next-draft').disabled = drafts.length <= 1;
                            document.getElementById('proceed-to-dialogue').disabled = false;
                            
                            // 显示所有剧本的最后一段
                            if (drafts.length > 0) {
                                currentDraftIndex = drafts.length - 1;
                                showDraft(currentDraftIndex);
                                draftSelector.value = currentDraftIndex;
                            }
                            
                            // 更新状态
                            document.getElementById('script-draft-status').textContent = '已完成';
                        }
                        
                    } catch (e) {
                        console.error("解析剧本数据失败:", e);
                        document.getElementById('script-draft-status').textContent = '数据解析错误';
                    }
                    
                    // 完成任务后关闭事件流
                    if (data.is_final) {
                        eventSource.close();
                    }
                }
                else if (data.status === 'error') {
                    // 显示错误信息
                    document.getElementById('draft-content').textContent = `错误: ${data.message}`;
                    document.getElementById('script-draft-status').textContent = '发生错误';
                    
                    // 启用重试按钮
                    document.getElementById('draft-script').disabled = false;
                    
                    // 关闭事件流
                    eventSource.close();
                }
            };
        }
    });
});

// 显示指定索引的剧本
function showDraft(index) {
    const draftSelector = document.getElementById('draft-selector');
    const draftContent = document.getElementById('draft-content');
    
    if (draftSelector.options.length <= index + 1) return; // +1 是因为第一个选项是"选择剧本段落..."
    
    const option = draftSelector.options[index + 1];
    if (!option) return;
    
    // 从剧本数据中获取内容
    fetch('/api/get_creation_state')
        .then(response => response.json())
        .then(state => {
            if (state.script_drafts && state.script_drafts.length > index) {
                const draftHtml = formatScriptContent(state.script_drafts[index]);
                draftContent.innerHTML = draftHtml;
            } else {
                draftContent.textContent = '无法加载剧本内容';
            }
        })
        .catch(error => {
            console.error('Error loading draft:', error);
            draftContent.textContent = '加载剧本时发生错误';
        });
}

// 格式化剧本内容
function formatScriptContent(scriptXml) {
    // 提取<script_draft>标签内的内容
    const contentMatch = /<script_draft>([\s\S]*?)<\/script_draft>/.exec(scriptXml);
    if (!contentMatch) return scriptXml;
    
    let content = contentMatch[1];
    
    // 替换场景标题标签
    content = content.replace(/<scene_heading>([\s\S]*?)<\/scene_heading>/g, 
        '<div class="scene-heading">$1</div>');
    
    // 替换角色表演标签
    content = content.replace(/<character_performance>([\s\S]*?)<\/character_performance>/g, 
        '<div class="character-performance">$1</div>');
    
    // 替换角色名称标签
    content = content.replace(/<character>([\s\S]*?)<\/character>/g, 
        '<div class="character-name">$1:</div>');
    
    // 替换表演内容标签
    content = content.replace(/<performance>([\s\S]*?)<\/performance>/g, 
        '<div class="performance">$1</div>');
    
    return content;
}

// 处理剧本选择器变化
document.getElementById('draft-selector').addEventListener('change', function() {
    const selectedIndex = parseInt(this.value);
    if (!isNaN(selectedIndex)) {
        showDraft(selectedIndex);
        
        // 更新导航按钮状态
        document.getElementById('prev-draft').disabled = selectedIndex <= 0;
        document.getElementById('next-draft').disabled = selectedIndex >= this.options.length - 2; // -2是因为还有一个"选择剧本段落..."
    }
});

// 处理上一段按钮
document.getElementById('prev-draft').addEventListener('click', function() {
    const draftSelector = document.getElementById('draft-selector');
    const currentIndex = parseInt(draftSelector.value);
    
    if (!isNaN(currentIndex) && currentIndex > 0) {
        const newIndex = currentIndex - 1;
        draftSelector.value = newIndex;
        showDraft(newIndex);
        
        // 更新导航按钮状态
        document.getElementById('prev-draft').disabled = newIndex <= 0;
        document.getElementById('next-draft').disabled = false;
    }
});

// 处理下一段按钮
document.getElementById('next-draft').addEventListener('click', function() {
    const draftSelector = document.getElementById('draft-selector');
    const currentIndex = parseInt(draftSelector.value);
    
    if (!isNaN(currentIndex) && currentIndex < draftSelector.options.length - 2) {
        const newIndex = currentIndex + 1;
        draftSelector.value = newIndex;
        showDraft(newIndex);
        
        // 更新导航按钮状态
        document.getElementById('prev-draft').disabled = false;
        document.getElementById('next-draft').disabled = newIndex >= draftSelector.options.length - 2;
    }
});

// 处理进入对话补充阶段的按钮
document.getElementById('proceed-to-dialogue').addEventListener('click', function() {
    alert('剧本草拟已完成！角色对话补充功能将在下一阶段实现。');
}); 