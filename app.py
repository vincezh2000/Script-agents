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
outline_writer_assistant = None  # 新增大纲撰写Assistant
outline_editor_assistant = None  # 新增大纲编辑器Assistant
story_writer_assistant = None  # 新增故事扩写Assistant
script_writer_assistant = None  # 新增剧本草拟Assistant

# 存储创作状态
creation_state = {
    'current_stage': 1,
    'storyline': '',
    'characters_xml': '',  # 存储原始XML格式的角色数据
    'characters_data': {},  # 存储解析后的角色数据（方便后续使用）
    'character_iterations': 0,
    'editor_advice': '',    # 存储编辑器的建议
    'max_iterations': 2,    # 默认最大迭代次数
    'outline_xml': '',      # 存储原始XML格式的大纲数据
    'outline_data': {},      # 存储解析后的大纲数据
    'outline_iterations': 0,# 大纲迭代次数
    'outline_editor_advice': '', # 存储大纲编辑器的建议
    'story_chapters': [],      # 存储生成的章节内容
    'characters_appeared': [],  # 追踪已经出现的角色
    'script_drafts': [],      # 存储生成的剧本草稿
    'current_draft_index': 0  # 当前处理的剧本索引
}

# 存储运行中的任务
active_tasks = {}

# 初始化thread和assistant
def initialize_openai_resources():
    global project_thread, character_writer_assistant, character_editor_assistant, outline_writer_assistant, outline_editor_assistant, story_writer_assistant, script_writer_assistant
    
    # 获取环境变量中的assistant ID
    character_writer_assistant_id = os.getenv("CHARACTER_WRITER_THREAD_ID")
    character_editor_assistant_id = os.getenv("CHARACTER_EDITOR_THREAD_ID")
    outline_writer_assistant_id = os.getenv("OUTLINE_WRITER_THREAD_ID")
    outline_editor_assistant_id = os.getenv("OUTLINE_EDITOR_THREAD_ID")
    story_writer_assistant_id = os.getenv("STORY_WRITER_THREAD_ID")
    script_writer_assistant_id = os.getenv("SCRIPT_WRITER_THREAD_ID")
    
    # 验证assistant ID是否存在
    if not character_writer_assistant_id:
        raise ValueError("CHARACTER_WRITER_THREAD_ID not found in environment variables")
    if not character_editor_assistant_id:
        raise ValueError("CHARACTER_EDITOR_THREAD_ID not found in environment variables")
    if not outline_writer_assistant_id:
        raise ValueError("OUTLINE_WRITER_THREAD_ID not found in environment variables")
    if not outline_editor_assistant_id:
        raise ValueError("OUTLINE_EDITOR_THREAD_ID not found in environment variables")
    if not story_writer_assistant_id:
        raise ValueError("STORY_WRITER_THREAD_ID not found in environment variables")
    if not script_writer_assistant_id:
        raise ValueError("SCRIPT_WRITER_THREAD_ID not found in environment variables")
    
    # 获取已创建的assistants
    try:
        character_writer_assistant = client.beta.assistants.retrieve(character_writer_assistant_id)
        print(f"Character Writer Assistant loaded: {character_writer_assistant.id}")
        
        character_editor_assistant = client.beta.assistants.retrieve(character_editor_assistant_id)
        print(f"Character Editor Assistant loaded: {character_editor_assistant.id}")
        
        outline_writer_assistant = client.beta.assistants.retrieve(outline_writer_assistant_id)
        print(f"Outline Writer Assistant loaded: {outline_writer_assistant.id}")
        
        outline_editor_assistant = client.beta.assistants.retrieve(outline_editor_assistant_id)
        print(f"Outline Editor Assistant loaded: {outline_editor_assistant.id}")
        
        story_writer_assistant = client.beta.assistants.retrieve(story_writer_assistant_id)
        print(f"Story Writer Assistant loaded: {story_writer_assistant.id}")
        
        script_writer_assistant = client.beta.assistants.retrieve(script_writer_assistant_id)
        print(f"Script Writer Assistant loaded: {script_writer_assistant.id}")
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
        "character_editor_assistant_id": character_editor_assistant.id,
        "outline_writer_assistant_id": outline_writer_assistant.id,
        "outline_editor_assistant_id": outline_editor_assistant.id,
        "story_writer_assistant_id": story_writer_assistant.id,
        "script_writer_assistant_id": script_writer_assistant.id
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

# 解析XML格式的大纲数据
def parse_outline_xml(xml_content):
    outline = {}
    
    # 使用正则表达式提取主要情节和子情节
    plot_pattern = r'<plot_(\w+)>(.*?)</plot_\1>'
    scene_pattern = r'<scene>(.*?)</scene>'
    characters_pattern = r'<characters>(.*?)</characters>'
    
    # 查找所有情节块
    plot_matches = re.finditer(plot_pattern, xml_content, re.DOTALL)
    
    for match in plot_matches:
        plot_id = match.group(1)
        plot_content = match.group(2).strip()
        
        # 提取场景
        scene_match = re.search(scene_pattern, plot_content, re.DOTALL)
        scene = scene_match.group(1).strip() if scene_match else ""
        
        # 提取角色
        characters_match = re.search(characters_pattern, plot_content, re.DOTALL)
        characters = characters_match.group(1).strip() if characters_match else ""
        
        # 删除场景和角色标签，获取纯情节内容
        content = re.sub(scene_pattern, '', plot_content, flags=re.DOTALL)
        content = re.sub(characters_pattern, '', content, flags=re.DOTALL).strip()
        
        outline[plot_id] = {
            "content": content,
            "scene": scene,
            "characters": characters
        }
    
    return outline

@app.route('/api/generate_outline', methods=['POST'])
def generate_outline():
    # 创建任务ID
    task_id = str(uuid.uuid4())
    
    # 获取请求中的数据
    data = request.json
    
    # 存储任务信息
    active_tasks[task_id] = {
        "status": "pending",
        "content": "",
        "run_id": None
    }
    
    # 启动异步处理
    def process_task():
        try:
            # 加载提示词模板
            prompts = load_prompts()
            
            # 使用大纲生成提示词
            generate_prompt = prompts["outline"]["writer"]["generate_prompt"]
            
            # 替换提示词中的占位符
            generate_prompt = generate_prompt.replace("[preliminary storyline]", creation_state['storyline'])
            generate_prompt = generate_prompt.replace("[Characters output in the prior step.]", creation_state['characters_xml'])
            
            # 更新任务状态
            active_tasks[task_id]["status"] = "running"
            
            # 创建消息
            client.beta.threads.messages.create(
                thread_id=project_thread.id,
                role="user",
                content=generate_prompt
            )
            
            # 运行outline writer assistant
            run = client.beta.threads.runs.create(
                thread_id=project_thread.id,
                assistant_id=outline_writer_assistant.id
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
                
                # 提取<outline>标签内的内容
                outline_match = re.search(r'<outline>(.*?)</outline>', content, re.DOTALL)
                if outline_match:
                    outline_xml = f"<outline>{outline_match.group(1)}</outline>"
                    
                    # 更新创作状态
                    creation_state['outline_xml'] = outline_xml
                    creation_state['outline_data'] = parse_outline_xml(outline_xml)
                    creation_state['current_stage'] = 4  # 更新阶段为大纲撰写完成
                    
                    # 完成任务
                    active_tasks[task_id]["status"] = "completed"
                    active_tasks[task_id]["content"] = content
                else:
                    active_tasks[task_id]["status"] = "error"
                    active_tasks[task_id]["error"] = "No outline data found in response"
            else:
                active_tasks[task_id]["status"] = "error"
                active_tasks[task_id]["error"] = "Failed to get outline writer response"
        except Exception as e:
            active_tasks[task_id]["status"] = "error"
            active_tasks[task_id]["error"] = str(e)
    
    # 启动处理线程
    thread = threading.Thread(target=process_task)
    thread.daemon = True
    thread.start()
    
    return jsonify({"status": "success", "task_id": task_id})

@app.route('/api/review_outline', methods=['POST'])
def review_outline():
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
            
            # 使用当前的大纲
            current_outline_xml = creation_state['outline_xml']
            
            # 迭代循环直到达到最大迭代次数或编辑器返回"None"
            while current_iteration < max_iterations:
                # 存储当前迭代的数据
                iteration_data = {
                    "iteration": current_iteration + 1,
                    "editor_advice": "",
                    "revised_outline": ""
                }
                
                # 选择正确的editor提示词
                if is_first_iteration:
                    # 第一次迭代使用feedback_prompt
                    editor_prompt = prompts["outline"]["editor"]["feedback_prompt"]
                    editor_prompt = editor_prompt.replace("[initial outline written by Writer]", current_outline_xml)
                else:
                    # 后续迭代使用continue_feedback_prompt
                    editor_prompt = prompts["outline"]["editor"]["continue_feedback_prompt"]
                    editor_prompt = editor_prompt.replace("[Writer's revised outline]", current_outline_xml)
                
                # 替换共用的占位符
                editor_prompt = editor_prompt.replace("[preliminary storyline]", creation_state['storyline'])
                editor_prompt = editor_prompt.replace("[characters]", creation_state['characters_xml'])
                
                # 更新任务状态
                active_tasks[task_id]["status"] = "running"
                
                # 创建消息
                client.beta.threads.messages.create(
                    thread_id=project_thread.id,
                    role="user",
                    content=editor_prompt
                )
                
                # 运行outline editor assistant
                run = client.beta.threads.runs.create(
                    thread_id=project_thread.id,
                    assistant_id=outline_editor_assistant.id
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
                        active_tasks[task_id]["error"] = f"Editor run failed with status: {run_status.status}"
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
                    
                    # 提取建议
                    advice_match = re.search(r'<advice>(.*?)</advice>', editor_content, re.DOTALL)
                    if advice_match:
                        advice = advice_match.group(1).strip()
                        
                        # 检查是否返回"None"，表示不需要更多修改
                        if advice.lower() == "none":
                            creation_state['current_stage'] = 5  # 更新阶段为大纲审阅完成
                            active_tasks[task_id]["status"] = "completed"
                            active_tasks[task_id]["content"] = json.dumps(active_tasks[task_id]["iteration_data"])
                            active_tasks[task_id]["is_final"] = True
                            return
                        
                        # 保存建议
                        creation_state['outline_editor_advice'] = advice
                        iteration_data["editor_advice"] = editor_content
                        
                        # 更新任务内容以显示编辑器建议
                        active_tasks[task_id]["status"] = "running"
                        active_tasks[task_id]["content"] = json.dumps([iteration_data])
                        
                        # 使用Writer修改大纲
                        writer_prompt = prompts["outline"]["writer"]["revise_prompt"]
                        writer_prompt = writer_prompt.replace("[Editor's advice on the outline]", advice)
                        writer_prompt = writer_prompt.replace("[preliminary storyline]", creation_state['storyline'])
                        writer_prompt = writer_prompt.replace("[characters]", creation_state['characters_xml'])
                        
                        # 创建消息
                        client.beta.threads.messages.create(
                            thread_id=project_thread.id,
                            role="user",
                            content=writer_prompt
                        )
                        
                        # 运行outline writer assistant
                        writer_run = client.beta.threads.runs.create(
                            thread_id=project_thread.id,
                            assistant_id=outline_writer_assistant.id
                        )
                        
                        active_tasks[task_id]["run_id"] = writer_run.id
                        
                        # 监控writer run状态
                        while True:
                            writer_run_status = client.beta.threads.runs.retrieve(
                                thread_id=project_thread.id,
                                run_id=writer_run.id
                            )
                            
                            if writer_run_status.status == 'completed':
                                break
                            elif writer_run_status.status in ['failed', 'cancelled', 'expired']:
                                active_tasks[task_id]["status"] = "error"
                                active_tasks[task_id]["error"] = f"Writer run failed with status: {writer_run_status.status}"
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
                            
                            # 提取大纲内容
                            outline_match = re.search(r'<outline>(.*?)</outline>', writer_content, re.DOTALL)
                            if outline_match:
                                revised_outline_xml = f"<outline>{outline_match.group(1)}</outline>"
                                
                                # 更新创作状态
                                current_outline_xml = revised_outline_xml
                                creation_state['outline_xml'] = revised_outline_xml
                                creation_state['outline_data'] = parse_outline_xml(revised_outline_xml)
                                creation_state['outline_iterations'] += 1
                                
                                # 保存修改后的大纲
                                iteration_data["revised_outline"] = writer_content
                                active_tasks[task_id]["iteration_data"].append(iteration_data)
                                
                                # 更新任务内容
                                active_tasks[task_id]["content"] = json.dumps(active_tasks[task_id]["iteration_data"])
                                
                                # 准备下一次迭代
                                current_iteration += 1
                                is_first_iteration = False
                                
                                # 检查是否达到最大迭代次数
                                if current_iteration >= max_iterations:
                                    creation_state['current_stage'] = 5  # 更新阶段为大纲审阅完成
                                    active_tasks[task_id]["status"] = "completed"
                                    active_tasks[task_id]["is_final"] = True
                                    return
                            else:
                                active_tasks[task_id]["status"] = "error"
                                active_tasks[task_id]["error"] = "Failed to extract outline from writer response"
                                return
                        else:
                            active_tasks[task_id]["status"] = "error"
                            active_tasks[task_id]["error"] = "Failed to get writer response"
                            return
                    else:
                        active_tasks[task_id]["status"] = "error"
                        active_tasks[task_id]["error"] = "No advice found in editor response"
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

# 排序情节ID的辅助函数
def sort_key(id_str):
    """
    对情节ID进行排序的函数
    处理不同格式的ID: 1, 2, 1a, 1b, 10, 10a 等
    """
    if id_str.isdigit():
        return (int(id_str), '')
    else:
        # 对于类似 '1a', '2b' 的ID
        num_part = re.match(r'(\d+)', id_str).group(1)
        alpha_part = id_str[len(num_part):]
        return (int(num_part), alpha_part)

# 提取大纲中的所有情节ID，按照顺序排列
def extract_plot_ids_from_outline(outline_xml):
    plot_pattern = r'<plot_(\w+)>'
    matches = re.finditer(plot_pattern, outline_xml)
    plot_ids = [match.group(1) for match in matches]
    
    # 使用全局的sort_key函数
    return sorted(plot_ids, key=sort_key)

# 获取角色首次出现信息
def get_character_info_with_first_appearance(character_name, characters_data, characters_xml, already_appeared):
    # 找出对应角色的XML信息
    char_info = ""
    for char_id, char_data in characters_data.items():
        if char_data['full_name'].strip() == character_name.strip():
            # 检查是否第一次出现
            if character_name not in already_appeared:
                char_info += f"<character_{char_id}>\n"
                char_info += f"<full_name>(first appearance) {char_data['full_name']}</full_name>\n"
                char_info += f"<character_introduction>{char_data['introduction']}</character_introduction>\n"
                char_info += f"</character_{char_id}>\n"
                already_appeared.append(character_name)
            else:
                char_info += f"<character_{char_id}>\n"
                char_info += f"<full_name>{char_data['full_name']}</full_name>\n"
                char_info += f"<character_introduction>{char_data['introduction']}</character_introduction>\n"
                char_info += f"</character_{char_id}>\n"
            break
    
    return char_info

# 用于构建故事扩写的消息
def get_story_expansion_message(plot_id, plot_content, scene, characters, plots_processed, last_chapter, is_last_plot):
    """构建故事扩写的消息"""
    prompts = load_prompts()
    
    # 获取生成提示词模板
    generate_prompt = prompts["story"]["writer"]["generate_prompt"]
    
    # 替换提示词中的内容
    message = generate_prompt.replace("[current plot to be expanded]", plot_content)
    message = message.replace("[preliminary storyline]", creation_state['storyline'])
    message = message.replace("[scene]", scene)
    message = message.replace("[involved characters' introduction (note: characters making their first appearance will be given a special remark.)]", characters)
    
    # 替换[previous plot]为之前的所有plot内容
    previous_plots = "\n".join(plots_processed) if plots_processed else ""
    message = message.replace("[previous plot]", previous_plots)
    
    # 替换[closest chapter]为最后一个章节内容
    message = message.replace("[the closest previous just-occurred plot point's corresponding expanded story chapter]", last_chapter if last_chapter else "")
    
    # 替换[last plot]，判断当前plot是否为最后一个
    last_plot_text = "The current story plot point you need to expand is the last plot point of the story. So, make sure that your expanded story chapter has a clear end to the story." if is_last_plot else ""
    message = message.replace("[Whether or not the current plot is the last, \"\" if no, \"The current story plot point you need to expand is the last plot point of the story. So, make sure that your expanded story chapter has a clear end to the story.\" if yes.]", last_plot_text)
    
    return message

@app.route('/api/expand_story', methods=['POST'])
def expand_story():
    """扩写故事情节"""
    if not creation_state['outline_xml']:
        return jsonify({"status": "error", "message": "No outline data available"})
    
    # 获取大纲中的所有情节ID
    plot_ids = extract_plot_ids_from_outline(creation_state['outline_xml'])
    
    if not plot_ids:
        return jsonify({"status": "error", "message": "No valid plot points found in outline"})
    
    # 创建任务ID
    task_id = str(uuid.uuid4())
    active_tasks[task_id] = {
        "status": "processing",
        "content": "",
        "error": None,
        "run_id": None,
        "chapters": [],
        "is_final": False
    }
    
    # 初始化未出现过的角色列表
    characters_not_appeared = list(creation_state['characters_data'].keys())
    
    # 清空已生成的章节
    creation_state['story_chapters'] = []
    creation_state['characters_appeared'] = []
    
    # 处理任务的函数
    def process_expansion():
        try:
            # 存储已处理的plots和最后一个章节内容
            plots_processed = []
            last_chapter = ""
            
            for i, plot_id in enumerate(plot_ids):
                plot_data = creation_state['outline_data'][plot_id]
                
                # 提取情节内容
                plot_content = plot_data['content']
                scene = plot_data['scene']
                character_names = plot_data['characters'].split(',')
                
                # 处理角色信息
                characters_info = []
                for name in character_names:
                    name = name.strip()
                    # 在characters_data中查找角色
                    for char_id, char_data in creation_state['characters_data'].items():
                        if name.lower() in char_data['full_name'].lower():
                            char_info = f"<character>{char_id}</character>\n"
                            
                            # 检查角色是否是首次出现
                            is_first_appearance = char_id not in creation_state['characters_appeared']
                            
                            char_info += f"<full_name>{'(first appearance) ' if is_first_appearance else ''}{char_data['full_name']}</full_name>\n"
                            char_info += f"<character_introduction>{char_data['introduction']}</character_introduction>"
                            characters_info.append(char_info)
                            
                            # 将角色添加到已出现列表
                            if is_first_appearance:
                                creation_state['characters_appeared'].append(char_id)
                            
                            break
                
                characters_xml = "\n".join(characters_info)
                
                # 检查是否是最后一个情节
                is_last_plot = i == len(plot_ids) - 1
                
                # 构建story writer的消息
                message = get_story_expansion_message(
                    plot_id, 
                    plot_content, 
                    scene, 
                    characters_xml, 
                    plots_processed, 
                    last_chapter,
                    is_last_plot
                )
                
                # 添加当前plot到已处理列表
                plot_xml = f"<{plot_id}>\n{plot_content}\nScene: {scene}\nCharacters: {plot_data['characters']}\n</{plot_id}>"
                plots_processed.append(plot_xml)
                
                # 添加消息到线程
                client.beta.threads.messages.create(
                    thread_id=project_thread.id,
                    role="user",
                    content=message
                )
                
                # 运行story writer assistant
                run = client.beta.threads.runs.create(
                    thread_id=project_thread.id,
                    assistant_id=story_writer_assistant.id
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
                    
                    # 提取<chapter>标签内的内容
                    chapter_match = re.search(r'<chapter>(.*?)</chapter>', content, re.DOTALL)
                    if chapter_match:
                        chapter_content = f"<chapter>{chapter_match.group(1)}</chapter>"
                        
                        # 保存章节内容
                        creation_state['story_chapters'].append(chapter_content)
                        active_tasks[task_id]["chapters"].append({
                            "plot_id": plot_id,
                            "content": chapter_content
                        })
                        
                        # 更新任务内容
                        active_tasks[task_id]["content"] = json.dumps({
                            "plot_id": plot_id,
                            "chapter_content": chapter_content,
                            "progress": {
                                "current": i + 1,
                                "total": len(plot_ids)
                            }
                        })
                        
                        # 更新最后一个章节内容用于下一次扩写
                        last_chapter = chapter_content
                    else:
                        active_tasks[task_id]["status"] = "error"
                        active_tasks[task_id]["error"] = "No chapter content found in response"
                        return
                else:
                    active_tasks[task_id]["status"] = "error"
                    active_tasks[task_id]["error"] = "Failed to get story writer response"
                    return
            
            # 所有情节处理完成
            creation_state['current_stage'] = 6  # 更新阶段为子情节扩写完成
            active_tasks[task_id]["status"] = "completed"
            active_tasks[task_id]["is_final"] = True
            
            # 合并所有章节
            full_story = "\n".join(creation_state['story_chapters'])
            active_tasks[task_id]["content"] = json.dumps({
                "full_story": full_story,
                "chapters": active_tasks[task_id]["chapters"],
                "progress": {
                    "current": len(plot_ids),
                    "total": len(plot_ids)
                }
            })
            
        except Exception as e:
            active_tasks[task_id]["status"] = "error"
            active_tasks[task_id]["error"] = str(e)
    
    # 启动处理线程
    thread = threading.Thread(target=process_expansion)
    thread.daemon = True
    thread.start()
    
    return jsonify({"status": "success", "task_id": task_id})

def get_script_draft_message(chapter_content, scene, characters_info):
    """构建剧本草拟的消息"""
    prompts = load_prompts()
    
    # 获取生成提示词模板
    generate_prompt = prompts["script"]["writer"]["generate_prompt"]
    
    # 替换提示词中的内容
    message = generate_prompt.replace("[story chapter]", chapter_content)
    message = message.replace("[scene]", scene)
    message = message.replace("[involved characters' introductions]", characters_info)
    
    return message

@app.route('/api/draft_script', methods=['POST'])
def draft_script():
    """草拟剧本"""
    if not creation_state['story_chapters']:
        return jsonify({"status": "error", "message": "No story chapters available"})
    
    # 创建任务ID
    task_id = str(uuid.uuid4())
    active_tasks[task_id] = {
        "status": "processing",
        "content": "",
        "error": None,
        "run_id": None,
        "drafts": [],
        "is_final": False
    }
    
    # 清空已生成的剧本草稿
    creation_state['script_drafts'] = []
    creation_state['current_draft_index'] = 0
    
    # 处理任务的函数
    def process_drafting():
        try:
            # 获取章节和对应的情节数据
            chapters = creation_state['story_chapters']
            
            # 使用专门的函数从outline_xml中提取情节ID，确保只获取有效的情节
            plot_ids = extract_plot_ids_from_outline(creation_state['outline_xml'])
            
            # 确保章节数量和情节数量一致
            if len(chapters) != len(plot_ids):
                active_tasks[task_id]["status"] = "error"
                active_tasks[task_id]["error"] = "Chapter count does not match plot count"
                return
            
            for i, (chapter, plot_id) in enumerate(zip(chapters, plot_ids)):
                # 提取章节内容
                chapter_match = re.search(r'<chapter>(.*?)</chapter>', chapter, re.DOTALL)
                if not chapter_match:
                    active_tasks[task_id]["status"] = "error"
                    active_tasks[task_id]["error"] = f"Failed to extract content from chapter {i+1}"
                    return
                
                chapter_content = chapter_match.group(1)
                
                # 获取对应情节的场景和角色
                plot_data = creation_state['outline_data'][plot_id]
                scene = plot_data['scene']
                character_names = plot_data['characters'].split(',')
                
                # 处理角色信息
                characters_info = []
                for name in character_names:
                    name = name.strip()
                    # 在characters_data中查找角色
                    for char_id, char_data in creation_state['characters_data'].items():
                        if name.lower() in char_data['full_name'].lower():
                            char_info = f"<character>{char_id}</character>\n"
                            char_info += f"<full_name>{char_data['full_name']}</full_name>\n"
                            char_info += f"<character_introduction>{char_data['introduction']}</character_introduction>"
                            characters_info.append(char_info)
                            break
                
                characters_xml = "\n".join(characters_info)
                
                # 构建script writer的消息
                message = get_script_draft_message(chapter_content, scene, characters_xml)
                
                # 添加消息到线程
                client.beta.threads.messages.create(
                    thread_id=project_thread.id,
                    role="user",
                    content=message
                )
                
                # 运行script writer assistant
                run = client.beta.threads.runs.create(
                    thread_id=project_thread.id,
                    assistant_id=script_writer_assistant.id
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
                    
                    # 提取<script_draft>标签内的内容
                    script_match = re.search(r'<script_draft>(.*?)</script_draft>', content, re.DOTALL)
                    if script_match:
                        script_content = f"<script_draft>{script_match.group(1)}</script_draft>"
                        
                        # 保存剧本内容
                        creation_state['script_drafts'].append(script_content)
                        active_tasks[task_id]["drafts"].append({
                            "chapter_index": i,
                            "plot_id": plot_id,
                            "content": script_content
                        })
                        
                        # 更新任务内容
                        active_tasks[task_id]["content"] = json.dumps({
                            "chapter_index": i,
                            "plot_id": plot_id,
                            "draft_content": script_content,
                            "progress": {
                                "current": i + 1,
                                "total": len(chapters)
                            }
                        })
                    else:
                        active_tasks[task_id]["status"] = "error"
                        active_tasks[task_id]["error"] = "No script draft content found in response"
                        return
                else:
                    active_tasks[task_id]["status"] = "error"
                    active_tasks[task_id]["error"] = "Failed to get script writer response"
                    return
            
            # 所有章节处理完成
            creation_state['current_stage'] = 7  # 更新阶段为剧本草拟完成
            active_tasks[task_id]["status"] = "completed"
            active_tasks[task_id]["is_final"] = True
            
            # 合并所有剧本草稿
            full_script = "\n\n".join(creation_state['script_drafts'])
            active_tasks[task_id]["content"] = json.dumps({
                "full_script": full_script,
                "drafts": active_tasks[task_id]["drafts"],
                "progress": {
                    "current": len(chapters),
                    "total": len(chapters)
                }
            })
            
        except Exception as e:
            active_tasks[task_id]["status"] = "error"
            active_tasks[task_id]["error"] = str(e)
    
    # 启动处理线程
    thread = threading.Thread(target=process_drafting)
    thread.daemon = True
    thread.start()
    
    return jsonify({"status": "success", "task_id": task_id})

if __name__ == '__main__':
    # 在应用启动时立即初始化OpenAI资源
    initialize_openai_resources()
    app.run(debug=True)
