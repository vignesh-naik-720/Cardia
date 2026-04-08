import json
import os
import uuid
from langchain_core.tools import tool

USER_DATA_FILE = "user_data.json"

def _load_data():
    if not os.path.exists(USER_DATA_FILE):
        return {"goals": [], "reminders": []}
    with open(USER_DATA_FILE, "r") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {"goals": [], "reminders": []}

def _save_data(data):
    with open(USER_DATA_FILE, "w") as f:
        json.dump(data, f, indent=4)

@tool
def set_goal(goal_description: str) -> str:
    """Sets a new health or fitness goal for the user."""
    data = _load_data()
    goal_id = str(uuid.uuid4())[:8]
    data.setdefault("goals", []).append({"id": goal_id, "description": goal_description})
    _save_data(data)
    return f"Goal successfully set: '{goal_description}' (ID: {goal_id})."

@tool
def list_goals_and_reminders() -> str:
    """Lists all current goals and reminders the user has set."""
    data = _load_data()
    goals = data.get("goals", [])
    reminders = data.get("reminders", [])
    
    response = "Current Goals:\n"
    if not goals:
        response += "- None\n"
    else:
        for g in goals:
            response += f"- [ID: {g.get('id')}] {g.get('description')}\n"
    
    response += "\nCurrent Reminders:\n"
    if not reminders:
        response += "- None\n"
    else:
        for r in reminders:
            response += f"- [ID: {r.get('id')}] {r.get('time')} - {r.get('description')}\n"
    
    return response

@tool
def set_reminder(reminder_description: str, time: str) -> str:
    """Sets a reminder for the user at a specific time (e.g., '10:00 AM', 'Tomorrow 5 PM')."""
    data = _load_data()
    reminder_id = str(uuid.uuid4())[:8]
    data.setdefault("reminders", []).append({
        "id": reminder_id, 
        "description": reminder_description, 
        "time": time
    })
    _save_data(data)
    return f"Reminder successfully set: '{reminder_description}' for {time} (ID: {reminder_id})."

@tool
def remove_reminder(reminder_id: str) -> str:
    """Removes a previously set reminder using its unique ID. Use list_goals_and_reminders to find the ID."""
    data = _load_data()
    reminders = data.get("reminders", [])
    initial_len = len(reminders)
    data["reminders"] = [r for r in reminders if r.get("id") != reminder_id]
    
    if len(data["reminders"]) < initial_len:
        _save_data(data)
        return f"Reminder with ID {reminder_id} was successfully removed."
    else:
        return f"Error: No reminder found with ID {reminder_id}."
