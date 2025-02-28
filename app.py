from flask import Flask, request, jsonify, render_template, Response, stream_with_context
import os
import json
from openai import OpenAI
from dotenv import load_dotenv
import time
import re
import uuid
import threading

# 加载环境变量
load_dotenv()

app = Flask(__name__, static_folder='static')

# 初始化OpenAI客户端
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# 全局变量
project_thread = None  # 整个项目共用一个线程
character_writer_assistant = None
character_editor_assistant = None  # 新增编辑器Assistant

# 存储创作状态
creation_state = {
    'current_stage': 1,
    'storyline': '',
    'characters_xml': '',  # 存储原始XML格式的角色数据
    'characters_data': {},  # 存储解析后的角色数据（方便后续使用）
    'character_iterations': 0,
    'editor_advice': '',    # 存储编辑器的建议
    'max_iterations': 2     # 默认最大迭代次数
}

# 存储运行中的任务
active_tasks = {}

# 初始化thread和assistant
def initialize_openai_resources():
    global project_thread, character_writer_assistant, character_editor_assistant
    
    # 获取环境变量中的assistant ID
    character_writer_assistant_id = os.getenv("CHARACTER_WRITER_THREAD_ID")
    character_editor_assistant_id = os.getenv("CHARACTER_EDITOR_THREAD_ID")
    
    # 验证assistant ID是否存在
    if not character_writer_assistant_id:
        raise ValueError("CHARACTER_WRITER_THREAD_ID not found in environment variables")
    if not character_editor_assistant_id:
        raise ValueError("EDITOR_THREAD_ID not found in environment variables")
    
    # 获取已创建的assistants
    try:
        character_writer_assistant = client.beta.assistants.retrieve(character_writer_assistant_id)
        print(f"Character Writer Assistant loaded: {character_writer_assistant.id}")
        
        character_editor_assistant = client.beta.assistants.retrieve(character_editor_assistant_id)
        print(f"Character Editor Assistant loaded: {character_editor_assistant.id}")
    except Exception as e:
        print(f"Error retrieving assistant: {e}")
        raise
    
    # 创建项目线程(固定使用一个线程)
    if project_thread is None:
        project_thread = client.beta.threads.create()
        print(f"Project thread created with ID: {project_thread.id}")

# 加载提示词模板
def load_prompts():
    with open('prompts.json', 'r', encoding='utf-8') as f:
        return json.load(f)

# 解析XML格式的角色数据
def parse_characters_xml(xml_content):
    characters = {}
    # 使用正则表达式提取角色信息
    character_pattern = r'<character_(\d+)>(.*?)</character_\1>'
    name_pattern = r'<full_name>(.*?)</full_name>'
    intro_pattern = r'<character_introduction>(.*?)</character_introduction>'
    
    # 查找所有角色块
    character_matches = re.finditer(character_pattern, xml_content, re.DOTALL)
    
    for match in character_matches:
        char_id = match.group(1)
        char_content = match.group(2)
        
        # 提取角色名称
        name_match = re.search(name_pattern, char_content, re.DOTALL)
        name = name_match.group(1) if name_match else "未命名角色"
        
        # 提取角色介绍
        intro_match = re.search(intro_pattern, char_content, re.DOTALL)
        intro = intro_match.group(1) if intro_match else "无介绍"
        
        characters[char_id] = {
            "full_name": name,
            "introduction": intro
        }
    
    return characters

# 提取编辑器建议
def extract_advice(content):
    advice_match = re.search(r'<advice>(.*?)</advice>', content, re.DOTALL)
    if advice_match:
        return advice_match.group(1).strip()
    return "No specific advice provided."

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/initialize', methods=['GET'])
def initialize():
    initialize_openai_resources()
    return jsonify({
        "status": "success", 
        "thread_id": project_thread.id,
        "character_writer_assistant_id": character_writer_assistant.id,
        "character_editor_assistant_id": character_editor_assistant.id
    })

@app.route('/api/generate_characters', methods=['POST'])
def generate_characters():
    data = request.json
    storyline = data.get('storyline', '')
    
    if not storyline:
        return jsonify({"error": "缺少故事线"}), 400
    
    # 更新创作状态
    creation_state['storyline'] = storyline
    
    # 创建任务ID
    task_id = str(uuid.uuid4())
    
    # 存储任务信息
    active_tasks[task_id] = {
        "status": "pending",
        "storyline": storyline,
        "content": "",
        "run_id": None
    }
    
    # 启动异步处理
    def process_task():
        try:
            # 加载提示词模板
            prompts = load_prompts()
            generate_prompt = prompts["characters"]["writer"]["generate_prompt"]
            
            # 替换提示词中的占位符
            generate_prompt = generate_prompt.replace("[preliminary storyline]", storyline)
            
            # 创建消息
            client.beta.threads.messages.create(
                thread_id=project_thread.id,
                role="user",
                content=generate_prompt
            )
            
            # 运行assistant
            run = client.beta.threads.runs.create(
                thread_id=project_thread.id,
                assistant_id=character_writer_assistant.id
            )
            
            # 更新任务状态
            active_tasks[task_id]["status"] = "running"
            active_tasks[task_id]["run_id"] = run.id
            
            # 监控run状态
            while True:
                run_status = client.beta.threads.runs.retrieve(
                    thread_id=project_thread.id,
                    run_id=run.id
                )
                
                if run_status.status == 'completed':
                    break
                elif run_status.status in ['failed', 'cancelled', 'expired']:
                    active_tasks[task_id]["status"] = "error"
                    active_tasks[task_id]["error"] = f"Run failed with status: {run_status.status}"
                    return
                
                time.sleep(1)
            
            # 获取消息
            messages = client.beta.threads.messages.list(
                thread_id=project_thread.id
            )
            
            # 获取最新的assistant消息
            latest_message = None
            for msg in messages.data:
                if msg.role == "assistant":
                    latest_message = msg
                    break
            
            if latest_message:
                content = latest_message.content[0].text.value
                
                # 提取<characters>标签内的内容
                characters_match = re.search(r'<characters>(.*?)</characters>', content, re.DOTALL)
                if characters_match:
                    characters_xml = f"<characters>{characters_match.group(1)}</characters>"
                    
                    # 更新创作状态 - 保存原生XML内容
                    creation_state['characters_xml'] = characters_xml
                    creation_state['characters_data'] = parse_characters_xml(characters_xml)
                    creation_state['character_iterations'] = 0  # 重置迭代次数
                    
                    # 更新任务状态
                    active_tasks[task_id]["status"] = "completed"
                    active_tasks[task_id]["content"] = content
                else:
                    active_tasks[task_id]["status"] = "error"
                    active_tasks[task_id]["error"] = "No characters data found in response"
        except Exception as e:
            active_tasks[task_id]["status"] = "error"
            active_tasks[task_id]["error"] = str(e)
    
    # 启动处理线程
    thread = threading.Thread(target=process_task)
    thread.daemon = True
    thread.start()
    
    return jsonify({"status": "success", "task_id": task_id})

@app.route('/api/review_characters', methods=['POST'])
def review_characters():
    # 创建任务ID
    task_id = str(uuid.uuid4())
    
    # 获取请求中的数据
    data = request.json
    max_iterations = data.get('max_iterations', 2)
    
    # 更新最大迭代次数
    creation_state['max_iterations'] = max_iterations
    
    # 存储任务信息
    active_tasks[task_id] = {
        "status": "pending",
        "content": "",
        "run_id": None,
        "iteration_data": []  # 保存每次迭代的数据
    }
    
    # 启动异步处理
    def process_review():
        try:
            # 加载提示词模板
            prompts = load_prompts()
            current_iteration = 0
            is_first_iteration = True
            
            # 使用当前的角色设计
            current_characters_xml = creation_state['characters_xml']
            
            # 迭代循环直到达到最大迭代次数或编辑器返回"None"
            while current_iteration < max_iterations:
                # 存储当前迭代的数据
                iteration_data = {
                    "iteration": current_iteration + 1,
                    "editor_advice": "",
                    "revised_characters": ""
                }
                
                # 选择正确的editor提示词
                if is_first_iteration:
                    # 第一次迭代使用feedback_prompt
                    editor_prompt = prompts["characters"]["editor"]["feedback_prompt"]
                    editor_prompt = editor_prompt.replace("[preliminary storyline]", creation_state['storyline'])
                    editor_prompt = editor_prompt.replace(
                        "[initial characters written by Writer]", 
                        current_characters_xml.replace("<characters>", "").replace("</characters>", "")
                    )
                else:
                    # 后续迭代使用continue_feedback_prompt
                    editor_prompt = prompts["characters"]["editor"]["continue_feedback_prompt"]
                    editor_prompt = editor_prompt.replace("[Writer's revised characters]", 
                                                        current_characters_xml.replace("<characters>", "").replace("</characters>", ""))
                    editor_prompt = editor_prompt.replace("[preliminary storyline]", creation_state['storyline'])
                
                # 更新任务状态
                active_tasks[task_id]["status"] = "running"
                
                # 创建消息 - Editor提供反馈
                client.beta.threads.messages.create(
                    thread_id=project_thread.id,
                    role="user",
                    content=editor_prompt
                )
                
                # 运行editor assistant
                run = client.beta.threads.runs.create(
                    thread_id=project_thread.id,
                    assistant_id=character_editor_assistant.id
                )
                
                active_tasks[task_id]["run_id"] = run.id
                
                # 监控run状态
                while True:
                    run_status = client.beta.threads.runs.retrieve(
                        thread_id=project_thread.id,
                        run_id=run.id
                    )
                    
                    if run_status.status == 'completed':
                        break
                    elif run_status.status in ['failed', 'cancelled', 'expired']:
                        active_tasks[task_id]["status"] = "error"
                        active_tasks[task_id]["error"] = f"Editor review failed with status: {run_status.status}"
                        return
                    
                    time.sleep(1)
                
                # 获取消息
                messages = client.beta.threads.messages.list(
                    thread_id=project_thread.id
                )
                
                # 获取最新的assistant消息
                editor_message = None
                for msg in messages.data:
                    if msg.role == "assistant":
                        editor_message = msg
                        break
                
                if editor_message:
                    editor_content = editor_message.content[0].text.value
                    
                    # 提取编辑器的建议
                    advice = extract_advice(editor_content)
                    
                    # 检查是否是"None"建议，表示已经没有修改建议了
                    if advice.strip().lower() == "none":
                        # 角色设计已完成，可以进入下一阶段
                        creation_state['current_stage'] = 4  # 更新阶段为大纲编写
                        
                        # 记录最后一次反馈
                        iteration_data["editor_advice"] = "完成！编辑器认为角色设计已经达到要求。"
                        active_tasks[task_id]["iteration_data"].append(iteration_data)
                        
                        # 完成任务
                        active_tasks[task_id]["status"] = "completed"
                        active_tasks[task_id]["content"] = json.dumps(active_tasks[task_id]["iteration_data"])
                        active_tasks[task_id]["is_final"] = True
                        return
                    
                    # 保存编辑器建议
                    creation_state['editor_advice'] = advice
                    iteration_data["editor_advice"] = advice
                    
                    # 使用writer的revise_prompt
                    revise_prompt = prompts["characters"]["writer"]["revise_prompt"]
                    
                    # 替换提示词中的占位符
                    revise_prompt = revise_prompt.replace("[Editor's advice on characters]", advice)
                    revise_prompt = revise_prompt.replace("[preliminary storyline]", creation_state['storyline'])
                    
                    # 创建消息 - Writer进行修改
                    client.beta.threads.messages.create(
                        thread_id=project_thread.id,
                        role="user",
                        content=revise_prompt
                    )
                    
                    # 运行writer assistant进行修改
                    run = client.beta.threads.runs.create(
                        thread_id=project_thread.id,
                        assistant_id=character_writer_assistant.id
                    )
                    
                    active_tasks[task_id]["run_id"] = run.id
                    
                    # 监控run状态
                    while True:
                        run_status = client.beta.threads.runs.retrieve(
                            thread_id=project_thread.id,
                            run_id=run.id
                        )
                        
                        if run_status.status == 'completed':
                            break
                        elif run_status.status in ['failed', 'cancelled', 'expired']:
                            active_tasks[task_id]["status"] = "error"
                            active_tasks[task_id]["error"] = f"Writer revision failed with status: {run_status.status}"
                            return
                        
                        time.sleep(1)
                    
                    # 获取消息
                    messages = client.beta.threads.messages.list(
                        thread_id=project_thread.id
                    )
                    
                    # 获取最新的assistant消息
                    writer_message = None
                    for msg in messages.data:
                        if msg.role == "assistant":
                            writer_message = msg
                            break
                    
                    if writer_message:
                        writer_content = writer_message.content[0].text.value
                        
                        # 提取<characters>标签内的内容
                        characters_match = re.search(r'<characters>(.*?)</characters>', writer_content, re.DOTALL)
                        if characters_match:
                            revised_characters_xml = f"<characters>{characters_match.group(1)}</characters>"
                            
                            # 更新当前使用的角色设计
                            current_characters_xml = revised_characters_xml
                            
                            # 更新创作状态
                            creation_state['characters_xml'] = revised_characters_xml
                            creation_state['characters_data'] = parse_characters_xml(revised_characters_xml)
                            creation_state['character_iterations'] += 1
                            
                            # 保存修改后的角色
                            iteration_data["revised_characters"] = writer_content
                            active_tasks[task_id]["iteration_data"].append(iteration_data)
                            
                            # 更新任务内容
                            active_tasks[task_id]["content"] = json.dumps(active_tasks[task_id]["iteration_data"])
                            
                            # 准备下一次迭代
                            current_iteration += 1
                            is_first_iteration = False
                            
                            # 检查是否达到最大迭代次数
                            if current_iteration >= max_iterations:
                                creation_state['current_stage'] = 4  # 更新阶段为大纲编写
                                active_tasks[task_id]["status"] = "completed"
                                active_tasks[task_id]["is_final"] = True
                                return
                        else:
                            active_tasks[task_id]["status"] = "error"
                            active_tasks[task_id]["error"] = "Failed to extract characters from writer response"
                            return
                    else:
                        active_tasks[task_id]["status"] = "error"
                        active_tasks[task_id]["error"] = "Failed to get writer response"
                        return
                else:
                    active_tasks[task_id]["status"] = "error"
                    active_tasks[task_id]["error"] = "Failed to get editor response"
                    return
                
        except Exception as e:
            active_tasks[task_id]["status"] = "error"
            active_tasks[task_id]["error"] = str(e)
    
    # 启动处理线程
    thread = threading.Thread(target=process_review)
    thread.daemon = True
    thread.start()
    
    return jsonify({"status": "success", "task_id": task_id})

@app.route('/api/tasks/<task_id>/stream', methods=['GET'])
def stream_task(task_id):
    if task_id not in active_tasks:
        return jsonify({"error": "任务不存在"}), 404
    
    def generate():
        task = active_tasks[task_id]
        
        # 等待任务开始处理
        while task["status"] == "pending":
            time.sleep(0.5)
            yield f"data: {json.dumps({'status': 'pending'})}\n\n"
        
        # 如果任务出错
        if task["status"] == "error":
            yield f"data: {json.dumps({'status': 'error', 'message': task.get('error', '未知错误')})}\n\n"
            return
        
        # 如果任务正在运行
        if task["status"] == "running":
            yield f"data: {json.dumps({'status': 'running'})}\n\n"
            
            # 等待任务完成
            while task["status"] == "running":
                time.sleep(1)
                yield f"data: {json.dumps({'status': 'running'})}\n\n"
            
            # 检查是否完成或出错
            if task["status"] == "error":
                yield f"data: {json.dumps({'status': 'error', 'message': task.get('error', '未知错误')})}\n\n"
                return
        
        # 任务完成，输出内容
        if task["status"] == "completed":
            content = task["content"]
            is_final = task.get("is_final", False)
            
            # 分段输出，模拟打字效果
            for i in range(0, len(content), 3):
                chunk = content[i:i+3]
                yield f"data: {json.dumps({'status': 'streaming', 'content': chunk})}\n\n"
                time.sleep(0.01)  # 控制输出速度
            
            # 输出完成信号，带上是否是最终版本的标志
            yield f"data: {json.dumps({'status': 'complete', 'content': content, 'is_final': is_final})}\n\n"
    
    return Response(stream_with_context(generate()), content_type='text/event-stream')

@app.route('/api/get_creation_state', methods=['GET'])
def get_creation_state():
    return jsonify(creation_state)

if __name__ == '__main__':
    # 在应用启动时立即初始化OpenAI资源
    initialize_openai_resources()
    app.run(debug=True)
