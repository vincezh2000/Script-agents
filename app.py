from flask import Flask, request, jsonify, render_template, Response, stream_with_context
import os
import json
from openai import OpenAI
from dotenv import load_dotenv
import time
import re
import uuid
import threading
import datetime

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
    'current_draft_index': 0,  # 当前处理的剧本索引
    'project_id': '',
    'last_updated_at': ''
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
    
    # 初始化项目：创建新的项目ID和时间戳
    creation_state['project_id'] = f"proj_{int(time.time())}"
    creation_state['created_at'] = datetime.datetime.now().isoformat()
    creation_state['last_updated_at'] = creation_state['created_at']
    
    # 保存初始状态
    # save_creation_state('initialize')
    
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
                    
                    # 新增：保存创作状态
                    save_creation_state('generate_characters')
                    
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
                        
                        # 新增：保存创作状态
                        save_creation_state('review_characters')
                        
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
    """获取当前创作状态"""
    try:
        # 返回创作状态的深拷贝，避免外部修改
        import copy
        state_copy = copy.deepcopy(creation_state)
        
        # 记录一下请求
        print(f"获取创作状态: 当前阶段={state_copy.get('current_stage', '未知')}, 项目ID={state_copy.get('project_id', '未知')}")
        
        return jsonify(state_copy)
    except Exception as e:
        print(f"获取创作状态时出错: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"获取创作状态失败: {str(e)}"}), 500

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
                    
                    # 新增：保存创作状态
                    save_creation_state('generate_outline')
                    
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
            
            # 新增: 在所有章节扩写完成后保存状态
            save_creation_state('expand_story_completed')
            
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
            
            for i, (plot_id, chapter) in enumerate(zip(plot_ids, chapters)):
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
                        
                        # 新增: 在每个剧本段落生成后保存状态
                        save_creation_state(f'draft_script_segment_{i+1}')
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
            
            # 新增: 在所有剧本草拟完成后保存状态
            save_creation_state('draft_script_completed')
            
        except Exception as e:
            active_tasks[task_id]["status"] = "error"
            active_tasks[task_id]["error"] = str(e)
    
    # 启动处理线程
    thread = threading.Thread(target=process_drafting)
    thread.daemon = True
    thread.start()
    
    return jsonify({"status": "success", "task_id": task_id})

# 新增：确保项目存储目录存在
def ensure_project_dirs():
    """确保项目存储目录存在"""
    if not os.path.exists('projects'):
        os.makedirs('projects')

# 新增：用于保存创作状态的函数
def save_creation_state(stage_name=None):
    """
    将当前创作状态保存为JSON文件
    
    参数:
        stage_name: 当前完成的阶段名称，用于文件命名
    """
    # 确保项目有ID
    if not creation_state['project_id']:
        creation_state['project_id'] = f"proj_{int(time.time())}"
    
    # 更新最后更新时间
    creation_state['last_updated_at'] = datetime.datetime.now().isoformat()
    
    # 创建项目目录（如果不存在）
    project_dir = os.path.join('projects', creation_state['project_id'])
    if not os.path.exists(project_dir):
        os.makedirs(project_dir)
    
    # 生成带有时间戳和阶段名称的文件名
    timestamp = int(time.time())
    stage_suffix = f"_{stage_name}" if stage_name else ""
    filename = f"state_{timestamp}{stage_suffix}.json"
    filepath = os.path.join(project_dir, filename)
    
    # 将创作状态写入JSON文件
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(creation_state, f, ensure_ascii=False, indent=2)
    
    print(f"创作状态已保存至: {filepath}")
    
    # 同时更新最新状态文件（用于简单加载）
    latest_filepath = os.path.join(project_dir, 'latest_state.json')
    with open(latest_filepath, 'w', encoding='utf-8') as f:
        json.dump(creation_state, f, ensure_ascii=False, indent=2)
    
    return filepath

# 新增API：获取所有项目列表
@app.route('/api/projects', methods=['GET'])
def list_projects():
    """获取所有已创建项目的列表"""
    ensure_project_dirs()
    
    projects = []
    if os.path.exists('projects'):
        for project_id in os.listdir('projects'):
            project_dir = os.path.join('projects', project_id)
            if os.path.isdir(project_dir):
                # 尝试加载项目的最新状态
                latest_state_path = os.path.join(project_dir, 'latest_state.json')
                if os.path.exists(latest_state_path):
                    try:
                        with open(latest_state_path, 'r', encoding='utf-8') as f:
                            state = json.load(f)
                            
                        # 获取项目的基本信息
                        project_info = {
                            'project_id': project_id,
                            'created_at': state.get('created_at', '未知'),
                            'last_updated_at': state.get('last_updated_at', '未知'),
                            'current_stage': state.get('current_stage', 1),
                            'storyline': state.get('storyline', '无故事线')[:100] + '...' if len(state.get('storyline', '')) > 100 else state.get('storyline', '无故事线')
                        }
                        projects.append(project_info)
                    except Exception as e:
                        print(f"读取项目{project_id}出错: {e}")
    
    # 按最后更新时间排序，最新的在前面
    projects.sort(key=lambda x: x.get('last_updated_at', ''), reverse=True)
    
    return jsonify({"projects": projects})

# 新增API：加载指定项目
@app.route('/api/projects/<project_id>/load', methods=['GET'])
def load_project(project_id):
    """加载指定项目的最新状态"""
    project_dir = os.path.join('projects', project_id)
    latest_state_path = os.path.join(project_dir, 'latest_state.json')
    
    if not os.path.exists(latest_state_path):
        return jsonify({"error": "项目不存在或尚未保存状态"}), 404
    
    try:
        with open(latest_state_path, 'r', encoding='utf-8') as f:
            state = json.load(f)
        
        # 更新全局状态
        global creation_state
        creation_state = state
        
        # 创建一个会话标志，指示项目已加载
        session_id = str(uuid.uuid4())
        
        # 返回一个处理后的状态，用于前端显示
        return jsonify({
            "status": "success", 
            "session_id": session_id,
            "state": format_state_for_display(state),
            "current_stage": state.get("current_stage", 1)
        })
    except Exception as e:
        return jsonify({"error": f"加载项目失败: {str(e)}"}), 500

# 增强状态格式化函数，添加更多详细信息
def format_state_for_display(state):
    """格式化状态数据，便于前端显示"""
    display_state = {
        "基本信息": {
            "项目ID": state.get("project_id", ""),
            "创建时间": state.get("created_at", ""),
            "最后更新": state.get("last_updated_at", ""),
            "当前阶段": get_stage_name(state.get("current_stage", 1))
        },
        "故事线": state.get("storyline", ""),
        "角色数量": len(state.get("characters_data", {})),
        "章节数量": len(state.get("story_chapters", [])),
        "剧本草稿数": len(state.get("script_drafts", []))
    }
    
    # 添加角色信息
    if state.get("characters_data"):
        display_state["角色"] = {}
        for char_id, char_info in state.get("characters_data", {}).items():
            display_state["角色"][char_info.get("full_name", f"角色{char_id}")] = char_info.get("introduction", "无介绍")
    
    # 添加章节摘要信息
    if state.get("story_chapters"):
        display_state["章节摘要"] = []
        for idx, chapter in enumerate(state.get("story_chapters", [])):
            # 提取章节标题和简短内容预览
            title = f"章节 {idx+1}"
            content_preview = chapter[:100] + "..." if len(chapter) > 100 else chapter
            display_state["章节摘要"].append({"标题": title, "预览": content_preview})
    
    # 添加剧本草稿摘要
    if state.get("script_drafts"):
        display_state["剧本草稿摘要"] = []
        for idx, draft in enumerate(state.get("script_drafts", [])):
            preview = draft[:100] + "..." if len(draft) > 100 else draft
            display_state["剧本草稿摘要"].append({"编号": idx+1, "预览": preview})
    
    return display_state

def get_stage_name(stage_num):
    """根据阶段编号返回阶段名称"""
    stages = {
        1: "初步故事线",
        2: "角色设计",
        3: "角色审阅与反馈",
        4: "故事大纲撰写",
        5: "大纲审阅与反馈",
        6: "子情节扩写",
        7: "剧本草拟",
        8: "角色扮演补充对话",
        9: "输出完整剧本"
    }
    return stages.get(stage_num, f"未知阶段({stage_num})")

# 添加API端点，在应用启动时设置初始加载状态
@app.route('/api/set_initial_state', methods=['POST'])
def set_initial_state():
    """设置初始状态，用于项目加载后的初始化"""
    data = request.json
    project_id = data.get('project_id')
    
    if not project_id:
        return jsonify({"error": "缺少项目ID"}), 400
        
    project_dir = os.path.join('projects', project_id)
    latest_state_path = os.path.join(project_dir, 'latest_state.json')
    
    if not os.path.exists(latest_state_path):
        return jsonify({"error": "项目不存在"}), 404
        
    try:
        print(f"加载项目状态: {project_id}")
        with open(latest_state_path, 'r', encoding='utf-8') as f:
            state = json.load(f)
            
        # 更新全局状态，打印关键信息
        global creation_state
        prev_stage = creation_state.get('current_stage', '未知')
        creation_state = state
        new_stage = creation_state.get('current_stage', '未知')
        
        print(f"项目状态已加载: 从阶段{prev_stage}切换到阶段{new_stage}")
        print(f"故事线长度: {len(state.get('storyline', ''))}")
        print(f"角色数量: {len(state.get('characters_data', {}))}")
        print(f"章节数量: {len(state.get('story_chapters', []))}")
        print(f"剧本数量: {len(state.get('script_drafts', []))}")
        
        # 返回成功
        return jsonify({
            "status": "success",
            "current_stage": state.get("current_stage", 1)
        })
    except Exception as e:
        print(f"设置初始状态失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"设置初始状态失败: {str(e)}"}), 500

# 添加最终脚本输出API
@app.route('/api/finalize_script', methods=['POST'])
def finalize_script():
    """将草拟的脚本整合为最终版本"""
    
    if not creation_state['script_drafts'] or len(creation_state['script_drafts']) == 0:
        return jsonify({"status": "error", "message": "No script drafts available"}), 400
    
    try:
        # 创建任务ID
        task_id = str(uuid.uuid4())
        active_tasks[task_id] = {
            "status": "processing",
            "content": "",
            "error": None,
            "is_final": False
        }
        
        # 合并所有剧本草稿
        full_script = "\n\n".join(creation_state['script_drafts'])
        
        # 更新阶段为最终脚本输出
        creation_state['current_stage'] = 8
        
        # 更新任务状态
        active_tasks[task_id]["status"] = "completed"
        active_tasks[task_id]["is_final"] = True
        active_tasks[task_id]["content"] = json.dumps({
            "full_script": full_script
        })
        
        # 保存最终状态
        save_creation_state('final_script_completed')
        
        return jsonify({
            "status": "success", 
            "task_id": task_id, 
            "full_script": full_script
        })
        
    except Exception as e:
        print(f"整合最终脚本时出错: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    # 在应用启动时立即初始化OpenAI资源
    initialize_openai_resources()
    ensure_project_dirs()
    app.run(debug=True, port=5000)
