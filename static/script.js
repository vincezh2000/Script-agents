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
                        
                        // 显示最后一次迭代的结果
                        if (iterationData && iterationData.length > 0) {
                            const lastIteration = iterationData[iterationData.length - 1];
                            
                            // 更新迭代计数
                            document.getElementById('iteration-count').textContent = lastIteration.iteration;
                            
                            // 显示编辑建议
                            document.getElementById('editor-advice-output').textContent = lastIteration.editor_advice;
                            
                            // 显示修改后的角色
                            document.getElementById('revised-character-output').textContent = lastIteration.revised_characters;
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
    alert('角色设计已完成！大纲编写功能将在下一阶段实现。');
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