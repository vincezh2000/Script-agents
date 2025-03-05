// 添加全局getStageName函数
// 将此代码放在文件顶部，确保它在任何其他代码之前定义
function getStageName(stageNum) {
    console.log(`获取阶段名称，阶段号: ${stageNum}`);
    const stages = {
        1: "初步故事线",
        2: "角色设计",
        3: "角色审阅与反馈",
        4: "故事大纲撰写",
        5: "大纲审阅与反馈",
        6: "子情节扩写",
        7: "剧本草拟",
        8: "角色扮演补充对话",
        9: "输出完整剧本"
    };
    const stageName = stages[stageNum] || `未知阶段(${stageNum})`;
    console.log(`阶段${stageNum}名称: ${stageName}`);
    return stageName;
}

// 初始化页面时连接到后端初始化API
document.addEventListener('DOMContentLoaded', function() {
    // 检查是否正在加载项目
    const isLoadingProject = localStorage.getItem('isLoadingProject') === 'true';
    const loadedProjectId = localStorage.getItem('loadedProjectId');
    
    if (isLoadingProject && loadedProjectId) {
        console.log('检测到项目加载请求:', loadedProjectId);
        
        // 清除加载标记
        localStorage.removeItem('isLoadingProject');
        
        // 初始化系统但不执行完整初始化
        fetch('/api/set_initial_state', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ project_id: loadedProjectId }),
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                console.log('已加载项目状态:', loadedProjectId);
                
                // 获取创作状态并更新UI
                fetchCreationStateAndUpdateUI(data.current_stage);
            } else {
                console.error('加载项目状态失败:', data.error);
                // 清除本地存储
                clearProjectStorage();
                // 执行常规初始化
                performRegularInitialization();
            }
        })
        .catch(error => {
            console.error('初始化状态请求失败:', error);
            // 清除本地存储
            clearProjectStorage();
            // 执行常规初始化
            performRegularInitialization();
        });
    } else {
        // 正常初始化
        performRegularInitialization();
    }
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
                            document.getElementById('proceed-to-final').disabled = false;
                            
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

// 项目浏览器功能
document.addEventListener('DOMContentLoaded', function() {
    // 获取模态窗口元素
    const modal = document.getElementById('project-browser');
    const closeBtn = modal.querySelector('.close');
    
    // 获取所有浏览项目按钮
    const browseBtns = document.querySelectorAll('.browse-projects-btn');
    
    // 获取项目列表和详情容器
    const projectListContainer = modal.querySelector('.project-list-container');
    const projectDetailContainer = modal.querySelector('.project-detail-container');
    const projectList = document.getElementById('project-list');
    const projectDetail = document.getElementById('project-detail');
    
    // 获取返回项目列表按钮
    const backToProjectsBtn = document.getElementById('back-to-projects');
    
    // 获取加载项目和新建项目按钮
    const loadProjectBtn = document.getElementById('load-project');
    const newProjectBtn = document.getElementById('new-project');
    
    // 当前选中的项目ID
    let selectedProjectId = null;
    
    // 为所有浏览项目按钮添加点击事件
    browseBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            // 显示模态窗口
            modal.style.display = 'block';
            
            // 加载项目列表
            loadProjects();
            
            // 显示项目列表，隐藏项目详情
            projectListContainer.classList.remove('hidden');
            projectDetailContainer.classList.add('hidden');
        });
    });
    
    // 关闭模态窗口
    closeBtn.addEventListener('click', function() {
        modal.style.display = 'none';
    });
    
    // 点击模态窗口外部关闭
    window.addEventListener('click', function(event) {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
    
    // 返回项目列表
    backToProjectsBtn.addEventListener('click', function() {
        projectDetailContainer.classList.add('hidden');
        projectListContainer.classList.remove('hidden');
    });
    
    // 加载项目
    loadProjectBtn.addEventListener('click', function() {
        if (selectedProjectId) {
            loadProjectState(selectedProjectId);
        }
    });
    
    // 新建项目
    newProjectBtn.addEventListener('click', function() {
        if (confirm('确定要创建新项目吗？当前进度将保存。')) {
            // 关闭模态窗口
            modal.style.display = 'none';
            
            // 重置创作状态并初始化
            resetToFirstStage();
        }
    });
    
    // 加载项目列表
    function loadProjects() {
        projectList.innerHTML = '<p>加载中...</p>';
        
        fetch('/api/projects')
            .then(response => response.json())
            .then(data => {
                if (data.projects && data.projects.length > 0) {
                    projectList.innerHTML = '';
                    
                    // 为每个项目创建卡片
                    data.projects.forEach(project => {
                        const card = document.createElement('div');
                        card.className = 'project-card';
                        card.dataset.projectId = project.project_id;
                        
                        // 格式化日期时间
                        const updatedDate = new Date(project.last_updated_at);
                        const formattedDate = `${updatedDate.getFullYear()}-${(updatedDate.getMonth()+1).toString().padStart(2, '0')}-${updatedDate.getDate().toString().padStart(2, '0')} ${updatedDate.getHours().toString().padStart(2, '0')}:${updatedDate.getMinutes().toString().padStart(2, '0')}`;
                        
                        // 获取阶段名称
                        const stageName = getStageName(project.current_stage);
                        
                        card.innerHTML = `
                            <h4>项目 ${project.project_id.replace('proj_', '')}</h4>
                            <div class="project-date">最后更新: ${formattedDate}</div>
                            <div class="project-stage">当前阶段: ${stageName}</div>
                            <div class="project-storyline">${project.storyline}</div>
                        `;
                        
                        // 添加点击事件，查看项目详情
                        card.addEventListener('click', function() {
                            selectedProjectId = project.project_id;
                            viewProjectDetail(project.project_id);
                        });
                        
                        projectList.appendChild(card);
                    });
                } else {
                    projectList.innerHTML = '<p>没有找到项目，请创建新项目。</p>';
                }
            })
            .catch(error => {
                console.error('加载项目列表失败:', error);
                projectList.innerHTML = '<p>加载项目列表失败，请刷新重试。</p>';
            });
    }
    
    // 查看项目详情
    function viewProjectDetail(projectId) {
        projectDetail.innerHTML = '<p>加载中...</p>';
        
        fetch(`/api/projects/${projectId}/load`)
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    // 显示项目详情，隐藏项目列表
                    projectListContainer.classList.add('hidden');
                    projectDetailContainer.classList.remove('hidden');
                    
                    // 显示格式化后的状态数据
                    const state = data.state;
                    projectDetail.innerHTML = '';
                    
                    // 基本信息
                    const basicInfoSection = createDetailSection('基本信息', 
                        createInfoTable([
                            { label: '项目ID', value: state.基本信息.项目ID },
                            { label: '创建时间', value: formatDateTime(state.基本信息.创建时间) },
                            { label: '最后更新', value: formatDateTime(state.基本信息.最后更新) },
                            { label: '当前阶段', value: state.基本信息.当前阶段 }
                        ])
                    );
                    projectDetail.appendChild(basicInfoSection);
                    
                    // 故事线
                    projectDetail.appendChild(createDetailSection('故事线', 
                        createParagraph(state.故事线)
                    ));
                    
                    // 角色信息
                    if (state.角色) {
                        const charTable = document.createElement('table');
                        charTable.className = 'character-table';
                        
                        for (const [name, intro] of Object.entries(state.角色)) {
                            const row = document.createElement('tr');
                            row.innerHTML = `
                                <td><strong>${name}</strong></td>
                                <td>${intro}</td>
                            `;
                            charTable.appendChild(row);
                        }
                        
                        projectDetail.appendChild(createDetailSection(`角色 (${state.角色数量}个)`, charTable));
                    }
                    
                    // 章节摘要
                    if (state.章节摘要 && state.章节摘要.length > 0) {
                        const chaptersList = document.createElement('ul');
                        chaptersList.className = 'chapters-list';
                        
                        state.章节摘要.forEach(chapter => {
                            const item = document.createElement('li');
                            item.innerHTML = `<strong>${chapter.标题}</strong>: ${chapter.预览}`;
                            chaptersList.appendChild(item);
                        });
                        
                        projectDetail.appendChild(createDetailSection(`章节内容 (${state.章节数量}个)`, chaptersList));
                    }
                    
                    // 剧本草稿摘要
                    if (state.剧本草稿摘要 && state.剧本草稿摘要.length > 0) {
                        const draftsList = document.createElement('ul');
                        draftsList.className = 'drafts-list';
                        
                        state.剧本草稿摘要.forEach(draft => {
                            const item = document.createElement('li');
                            item.innerHTML = `<strong>草稿 ${draft.编号}</strong>: ${draft.预览}`;
                            draftsList.appendChild(item);
                        });
                        
                        projectDetail.appendChild(createDetailSection(`剧本草稿 (${state.剧本草稿数}个)`, draftsList));
                    }
                    
                    // 创作进度总结
                    const progressSection = document.createElement('div');
                    progressSection.className = 'project-progress-summary';
                    progressSection.innerHTML = `
                        <div class="progress-item ${state.章节数量 > 0 ? 'completed' : ''}">
                            <span class="progress-icon">✓</span>
                            <span class="progress-text">场景扩写</span>
                        </div>
                        <div class="progress-item ${state.剧本草稿数 > 0 ? 'completed' : ''}">
                            <span class="progress-icon">✓</span>
                            <span class="progress-text">剧本草拟</span>
                        </div>
                    `;
                    
                    projectDetail.appendChild(createDetailSection('创作进度', progressSection));
                    
                } else {
                    projectDetail.innerHTML = `<p>加载项目详情失败: ${data.error}</p>`;
                }
            })
            .catch(error => {
                console.error('加载项目详情失败:', error);
                projectDetail.innerHTML = '<p>加载项目详情失败，请刷新重试。</p>';
            });
    }
    
    // 辅助函数：创建详情部分
    function createDetailSection(title, content) {
        const section = document.createElement('div');
        section.className = 'project-detail-section';
        
        const heading = document.createElement('h4');
        heading.textContent = title;
        section.appendChild(heading);
        
        if (typeof content === 'string') {
            section.innerHTML += content;
        } else {
            section.appendChild(content);
        }
        
        return section;
    }
    
    // 辅助函数：创建信息表格
    function createInfoTable(items) {
        const table = document.createElement('table');
        table.className = 'info-table';
        
        items.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.label}:</td>
                <td>${item.value}</td>
            `;
            table.appendChild(row);
        });
        
        return table;
    }
    
    // 辅助函数：创建段落
    function createParagraph(text) {
        const p = document.createElement('p');
        p.textContent = text;
        return p;
    }
    
    // 加载项目状态并更新UI
    function loadProjectState(projectId) {
        fetch(`/api/projects/${projectId}/load`)
            .then(response => response.json())
            .then(data => {
                if (data.status === 'success') {
                    // 存储项目ID和当前阶段
                    localStorage.setItem('loadedProjectId', projectId);
                    localStorage.setItem('currentStage', data.current_stage);
                    
                    // 标记页面正在加载项目
                    localStorage.setItem('isLoadingProject', 'true');
                    
                    // 关闭模态窗口
                    modal.style.display = 'none';
                    
                    // 刷新页面以应用加载的状态
                    location.reload();
                } else {
                    alert(`加载项目失败: ${data.error}`);
                }
            })
            .catch(error => {
                console.error('加载项目失败:', error);
                alert('加载项目失败，请刷新重试。');
            });
    }
    
    // 重置到第一阶段
    function resetToFirstStage() {
        // 重新初始化并刷新页面
        fetch('/initialize')
            .then(response => response.json())
            .then(() => {
                // 刷新页面
                location.reload();
            })
            .catch(error => {
                console.error('初始化失败:', error);
                alert('初始化新项目失败，请刷新重试。');
            });
    }
    
    // 辅助函数：格式化日期时间
    function formatDateTime(dateTimeStr) {
        if (!dateTimeStr) return '未知';
        
        try {
            const date = new Date(dateTimeStr);
            return `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        } catch (e) {
            return dateTimeStr;
        }
    }
});

// 添加更新UI以反映当前阶段的函数
function updateUIForStage(stageNumber) {
    // 更新左侧导航栏
    const steps = document.querySelectorAll('.workflow ol li');
    steps.forEach((step, index) => {
        step.classList.remove('active');
        if (index + 1 === parseInt(stageNumber)) {
            step.classList.add('active');
        }
    });
    
    // 更新当前阶段文本
    document.getElementById('current-stage').textContent = getStageName(stageNumber);
    
    // 隐藏所有阶段，然后显示当前阶段
    const stages = document.querySelectorAll('.stage');
    stages.forEach((stage, index) => {
        stage.classList.add('hidden');
        stage.classList.remove('active');
        
        if (index + 1 === parseInt(stageNumber)) {
            stage.classList.remove('hidden');
            stage.classList.add('active');
        } else if (index + 1 < parseInt(stageNumber)) {
            stage.classList.add('completed');
        }
    });
    
    // 根据阶段执行特定的初始化逻辑
    initializeStageContent(stageNumber);
}

// 添加根据阶段初始化内容的函数
function initializeStageContent(stageNumber) {
    // 获取创作状态
    fetch('/api/get_creation_state')
        .then(response => response.json())
        .then(state => {
            // 根据不同阶段执行不同的初始化
            switch (parseInt(stageNumber)) {
                case 1: // 初步故事线
                    document.getElementById('preliminary-storyline').value = state.storyline || '';
                    break;
                    
                case 2: // 角色设计
                    // 填充角色设计输出
                    if (state.characters_xml) {
                        document.getElementById('character-design-output').textContent = state.characters_xml;
                        document.getElementById('character-design-status').textContent = '已完成';
                        document.getElementById('proceed-to-review').disabled = false;
                    }
                    break;
                    
                case 3: // 角色审阅
                    // 填充角色审阅数据
                    if (state.editor_advice) {
                        document.getElementById('editor-advice-output').textContent = state.editor_advice;
                    }
                    if (state.characters_xml) {
                        document.getElementById('revised-character-output').textContent = state.characters_xml;
                    }
                    document.getElementById('character-review-status').textContent = 
                        state.character_iterations > 0 ? `已迭代 ${state.character_iterations} 次` : '等待开始';
                    break;
                    
                case 4: // 大纲撰写
                    // 填充大纲数据
                    if (state.outline_xml) {
                        document.getElementById('outline-output').innerHTML = formatOutlineHTML(state.outline_xml);
                        document.getElementById('outline-status').textContent = '已完成';
                        document.getElementById('proceed-to-outline-review').disabled = false;
                    }
                    break;
                    
                // 其他阶段的初始化...
                case 6: // 子情节扩写
                    if (state.story_chapters && state.story_chapters.length > 0) {
                        // 更新进度条
                        updateExpansionProgress(state.story_chapters.length, state.outline_data ? 
                            Object.keys(state.outline_data).length : state.story_chapters.length);
                        
                        // 填充章节选择器
                        populateChapterSelector(state.story_chapters);
                        
                        // 显示第一个章节
                        showChapter(0);
                        
                        // 更新状态
                        document.getElementById('story-expansion-status').textContent = '已完成';
                        document.getElementById('proceed-to-draft').disabled = false;
                    }
                    break;
                    
                case 7: // 剧本草拟
                    if (state.script_drafts && state.script_drafts.length > 0) {
                        // 更新进度条
                        updateDraftProgress(state.script_drafts.length, state.story_chapters.length);
                        
                        // 填充剧本选择器
                        populateDraftSelector(state.script_drafts);
                        
                        // 显示第一个剧本
                        showDraft(0);
                        
                        // 更新状态
                        document.getElementById('script-draft-status').textContent = '已完成';
                        document.getElementById('proceed-to-final').disabled = false;
                    }
                    break;
                    
                case 8: // 完整脚本输出
                    if (state.script_drafts && state.script_drafts.length > 0) {
                        // 合并所有剧本草稿为完整脚本
                        const fullScript = state.script_drafts.join("\n\n");
                        
                        // 格式化并显示
                        document.getElementById('final-script-content').innerHTML = formatScriptContent(fullScript);
                        document.getElementById('final-script-status').textContent = '已完成';
                        
                        // 启用下载按钮
                        document.getElementById('download-script').disabled = false;
                        document.getElementById('export-pdf').disabled = false;
                    }
                    break;
            }
        })
        .catch(error => {
            console.error('获取创作状态失败:', error);
        });
}

// 辅助函数：填充章节选择器
function populateChapterSelector(chapters) {
    const selector = document.getElementById('chapter-selector');
    selector.innerHTML = '<option value="">选择章节...</option>';
    
    chapters.forEach((chapter, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `章节 ${index + 1}`;
        selector.appendChild(option);
    });
    
    if (chapters.length > 0) {
        document.getElementById('prev-chapter').disabled = true;
        document.getElementById('next-chapter').disabled = chapters.length <= 1;
    }
}

// 辅助函数：填充剧本选择器
function populateDraftSelector(drafts) {
    const selector = document.getElementById('draft-selector');
    selector.innerHTML = '<option value="">选择剧本段落...</option>';
    
    drafts.forEach((draft, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `剧本段落 ${index + 1}`;
        selector.appendChild(option);
    });
    
    if (drafts.length > 0) {
        document.getElementById('prev-draft').disabled = true;
        document.getElementById('next-draft').disabled = drafts.length <= 1;
    }
}

// 辅助函数：更新扩写进度条
function updateExpansionProgress(completed, total) {
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    
    const percent = (completed / total) * 100;
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${completed} / ${total} 情节已完成`;
}

// 辅助函数：更新草稿进度条
function updateDraftProgress(completed, total) {
    const progressBar = document.getElementById('draft-progress-bar');
    const progressText = document.getElementById('draft-progress-text');
    
    const percent = (completed / total) * 100;
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${completed} / ${total} 章节已完成`;
}

// 格式化大纲为HTML
function formatOutlineHTML(outlineXml) {
    // 这里可以添加解析XML并格式化为HTML的逻辑
    // 简单实现：
    return `<div class="formatted-outline">${outlineXml.replace(/\n/g, '<br>')}</div>`;
}

// 改进获取创作状态并更新UI的函数
function fetchCreationStateAndUpdateUI(currentStage) {
    console.log('开始获取创作状态...', '当前阶段:', currentStage);
    
    try {
        // 先尝试加载并定义getStageName
        if (typeof getStageName !== 'function') {
            console.log('getStageName 未定义，尝试定义...');
            // 临时定义getStageName函数，确保不会出错
            window.getStageName = function(stageNum) {
                console.log(`获取阶段名称(临时函数)，阶段号: ${stageNum}`);
                const stages = {
                    1: "初步故事线",
                    2: "角色设计",
                    3: "角色审阅与反馈",
                    4: "故事大纲撰写",
                    5: "大纲审阅与反馈",
                    6: "子情节扩写",
                    7: "剧本草拟",
                    8: "角色扮演补充对话",
                    9: "输出完整剧本"
                };
                return stages[stageNum] || `未知阶段(${stageNum})`;
            };
            console.log('临时定义了getStageName函数');
        }
        
        fetch('/api/get_creation_state')
            .then(response => {
                console.log('收到API响应:', response.status);
                if (!response.ok) {
                    throw new Error(`API响应错误: ${response.status} ${response.statusText}`);
                }
                return response.json();
            })
            .then(state => {
                console.log('成功解析创作状态数据，属性列表:', Object.keys(state));
                
                try {
                    // 检查关键属性
                    console.log('项目ID:', state.project_id);
                    console.log('当前阶段:', state.current_stage);
                    console.log('故事线长度:', state.storyline ? state.storyline.length : 0);
                    console.log('角色数据长度:', Object.keys(state.characters_data || {}).length);
                    
                    // 更新基本UI元素
                    console.log('开始更新基本UI元素...');
                    updateBasicUI(state, currentStage);
                    
                    // 根据阶段更新特定内容
                    console.log(`开始更新阶段${currentStage}的特定内容...`);
                    updateStageContent(state, currentStage);
                    
                    console.log('UI更新完成!');
                } catch (err) {
                    console.error('UI更新过程中发生错误:', err);
                    console.error('错误详细信息:', err.message);
                    console.error('错误堆栈:', err.stack);
                    alert(`UI更新失败: ${err.message}`);
                }
            })
            .catch(error => {
                console.error('获取创作状态失败:', error);
                console.error('错误详细信息:', error.message);
                console.error('错误堆栈:', error.stack);
                alert(`获取项目状态失败: ${error.message}`);
                
                // 不要立即清除状态，给用户机会查看错误
                if (confirm('是否重置应用状态并返回初始界面?')) {
                    clearProjectStorage();
                    location.reload();
                }
            });
    } catch (outerError) {
        console.error('fetchCreationStateAndUpdateUI外层错误:', outerError);
        console.error('错误详细信息:', outerError.message);
        console.error('错误堆栈:', outerError.stack);
        alert(`获取创作状态过程中发生错误: ${outerError.message}`);
    }
}

// 更新基本UI元素 - 增强版
function updateBasicUI(state, stageNumber) {
    try {
        console.log(`开始更新基本UI元素，阶段号: ${stageNumber}`);
        
        // 更新左侧导航栏
        const steps = document.querySelectorAll('.workflow ol li');
        console.log(`找到${steps.length}个步骤元素`);
        
        steps.forEach((step, index) => {
            step.classList.remove('active');
            if (index + 1 === parseInt(stageNumber)) {
                step.classList.add('active');
            }
        });
        
        // 更新当前阶段文本
        const currentStageElement = safeGetElement('current-stage');
        if (currentStageElement) {
            currentStageElement.textContent = getStageName(stageNumber);
        }
        
        // 更新迭代设置
        const maxIterationsElement = safeGetElement('max-iterations');
        if (maxIterationsElement && state.max_iterations) {
            maxIterationsElement.value = state.max_iterations;
        }
        
        // 更新迭代计数
        const iterationCountElement = safeGetElement('iteration-count');
        if (iterationCountElement) {
            let iterationCount = 0;
            if (stageNumber == 3) {
                iterationCount = state.character_iterations || 0;
            } else if (stageNumber == 5) {
                iterationCount = state.outline_iterations || 0;
            }
            iterationCountElement.textContent = iterationCount;
        }
        
        // 隐藏所有阶段，然后显示当前阶段
        const stages = document.querySelectorAll('.stage');
        stages.forEach((stage, index) => {
            stage.classList.add('hidden');
            stage.classList.remove('active');
            
            if (index + 1 === parseInt(stageNumber)) {
                stage.classList.remove('hidden');
                stage.classList.add('active');
            } else if (index + 1 < parseInt(stageNumber)) {
                stage.classList.add('completed');
            }
        });
        
        console.log('基本UI元素更新完成');
    } catch (err) {
        console.error('updateBasicUI中发生错误:', err);
        throw err; // 重新抛出以便上层处理
    }
}

// 更新阶段内容 - 完整版
function updateStageContent(state, stageNumber) {
    try {
        console.log(`开始更新阶段${stageNumber}的内容`);
        console.log('状态数据:', state);
        
        switch (parseInt(stageNumber)) {
            case 1: // 初步故事线
                console.log('更新初步故事线...');
                const storylineElement = safeGetElement('preliminary-storyline');
                if (storylineElement) {
                    storylineElement.value = state.storyline || '';
                }
                break;
                
            case 2: // 角色设计
                console.log('更新角色设计...');
                // 填充角色设计输出
                if (state.characters_xml) {
                    const outputElement = safeGetElement('character-design-output');
                    if (outputElement) {
                        outputElement.innerHTML = formatCharacterXML(state.characters_xml);
                    }
                    
                    const statusElement = safeGetElement('character-design-status');
                    if (statusElement) {
                        statusElement.textContent = '已完成';
                    }
                    
                    const proceedBtn = safeGetElement('proceed-to-review');
                    if (proceedBtn) {
                        proceedBtn.disabled = false;
                    }
                }
                break;
                
            case 3: // 角色审阅
                console.log('更新角色审阅...');
                // 填充角色审阅数据
                if (state.editor_advice) {
                    const adviceElement = safeGetElement('editor-advice-output');
                    if (adviceElement) {
                        adviceElement.innerHTML = formatEditorAdvice(state.editor_advice);
                    }
                }
                
                if (state.characters_xml) {
                    const revisedCharElement = safeGetElement('revised-character-output');
                    if (revisedCharElement) {
                        revisedCharElement.innerHTML = formatCharacterXML(state.characters_xml);
                    }
                }
                
                const reviewStatusElement = safeGetElement('character-review-status');
                if (reviewStatusElement) {
                    reviewStatusElement.textContent = 
                        state.character_iterations > 0 ? `已迭代 ${state.character_iterations} 次` : '等待开始';
                }
                
                // 更新按钮状态
                const startReviewBtn = safeGetElement('start-review-process');
                if (startReviewBtn) {
                    startReviewBtn.disabled = state.character_iterations > 0;
                }
                
                const proceedToOutlineBtn = safeGetElement('proceed-to-outline');
                if (proceedToOutlineBtn) {
                    proceedToOutlineBtn.disabled = 
                        !(state.character_iterations > 0 && state.characters_xml);
                }
                break;
                
            case 4: // 大纲撰写
                console.log('更新大纲撰写...');
                // 填充大纲数据
                if (state.outline_xml) {
                    const outlineElement = safeGetElement('outline-output');
                    if (outlineElement) {
                        outlineElement.innerHTML = formatOutlineHTML(state.outline_xml);
                    }
                    
                    const outlineStatusElement = safeGetElement('outline-status');
                    if (outlineStatusElement) {
                        outlineStatusElement.textContent = '已完成';
                    }
                    
                    const proceedToReviewBtn = safeGetElement('proceed-to-outline-review');
                    if (proceedToReviewBtn) {
                        proceedToReviewBtn.disabled = false;
                    }
                }
                break;
                
            // 其他阶段的处理代码...
            
            default:
                console.log(`没有针对阶段${stageNumber}的特定处理逻辑`);
        }
        
        console.log(`阶段${stageNumber}内容更新完成`);
    } catch (err) {
        console.error(`updateStageContent阶段${stageNumber}中发生错误:`, err);
        throw err; // 重新抛出以便上层处理
    }
}

// 辅助函数：清除项目相关的本地存储
function clearProjectStorage() {
    localStorage.removeItem('loadedProjectId');
    localStorage.removeItem('currentStage');
    localStorage.removeItem('isLoadingProject');
}

// 辅助函数：执行常规初始化
function performRegularInitialization() {
    fetch('/initialize')
        .then(response => response.json())
        .then(data => {
            console.log('System initialized with thread ID:', data.thread_id);
        })
        .catch(error => {
            console.error('初始化失败:', error);
            document.getElementById('submit-storyline').disabled = true;
            alert('系统初始化失败，请刷新页面重试');
        });
}

// 辅助函数：格式化角色XML为HTML
function formatCharacterXML(xml) {
    // 简单格式化，在实际应用中可以做更复杂的HTML渲染
    return `<div class="formatted-xml">${xml.replace(/\n/g, '<br>')}</div>`;
}

// 辅助函数：格式化编辑建议为HTML
function formatEditorAdvice(advice) {
    return `<div class="editor-advice">${advice.replace(/\n/g, '<br>')}</div>`;
}

// 安全地获取DOM元素，如果不存在则记录错误但不抛出异常
function safeGetElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        console.warn(`找不到ID为"${id}"的元素`);
    }
    return element;
} 

// 处理进入最终脚本输出阶段的按钮
document.getElementById('proceed-to-final').addEventListener('click', function() {
    // 更新UI状态
    document.getElementById('current-stage').textContent = '完整脚本输出';
    
    // 切换到最终脚本输出阶段
    document.getElementById('stage-7').classList.remove('active');
    document.getElementById('stage-7').classList.add('completed');
    document.getElementById('stage-7').classList.add('hidden');
    
    document.getElementById('stage-8').classList.remove('hidden');
    document.getElementById('stage-8').classList.add('active');
    
    document.getElementById('step-7').classList.remove('active');
    document.getElementById('step-8').classList.add('active');
    
    // 更新状态文本
    document.getElementById('final-script-status').textContent = '准备中...';
    
    // 调用API生成最终脚本
    fetch('/api/finalize_script', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            // 格式化并显示最终脚本
            document.getElementById('final-script-content').innerHTML = formatScriptContent(data.full_script);
            document.getElementById('final-script-status').textContent = '已完成';
            
            // 启用下载按钮
            document.getElementById('download-script').disabled = false;
            document.getElementById('export-pdf').disabled = false;
        } else {
            document.getElementById('final-script-content').textContent = '生成最终脚本时出错：' + (data.message || '未知错误');
            document.getElementById('final-script-status').textContent = '出错';
        }
    })
    .catch(error => {
        console.error('获取最终脚本失败:', error);
        document.getElementById('final-script-content').textContent = '加载数据时出错';
        document.getElementById('final-script-status').textContent = '加载失败';
    });
});

// 处理下载完整脚本按钮
document.getElementById('download-script').addEventListener('click', function() {
    // 获取创作状态
    fetch('/api/get_creation_state')
        .then(response => response.json())
        .then(state => {
            if (state.script_drafts && state.script_drafts.length > 0) {
                // 合并所有剧本草稿为完整脚本
                const fullScript = state.script_drafts.join("\n\n");
                
                // 创建下载链接
                const blob = new Blob([fullScript], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `script_${state.project_id || 'download'}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                alert('未找到剧本数据，无法下载');
            }
        })
        .catch(error => {
            console.error('获取创作状态失败:', error);
            alert('下载脚本时出错');
        });
});

// 处理导出PDF按钮
document.getElementById('export-pdf').addEventListener('click', function() {
    alert('PDF导出功能将在后续版本中提供');
});

// 处理重新开始项目按钮
document.getElementById('restart-project').addEventListener('click', function() {
    if (confirm('确定要开始一个新项目吗？当前项目数据将被保存。')) {
        // 清除当前状态并重新加载页面
        clearProjectStorage();
        location.reload();
    }
});