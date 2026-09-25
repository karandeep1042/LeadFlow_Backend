import Task from '../models/Task.js';

export const getTasks = async (req, res) => {
  try {
    const filter = { ...req.tenantFilter };
    const { advisorId, isCompleted, priority, search } = req.query;

    if (req.user.role === 'advisor') {
      filter.$or = [{ assignedAdvisorId: req.user._id }, { assignedAdvisorId: null }];
    } else if (advisorId) {
      if (advisorId === 'unassigned') {
        filter.assignedAdvisorId = null;
      } else {
        filter.assignedAdvisorId = advisorId;
      }
    }

    if (typeof isCompleted !== 'undefined') {
      filter.isCompleted = isCompleted === 'true';
    }

    if (priority && priority !== 'all') {
      filter.priority = priority;
    }

    if (search) {
      filter.title = { $regex: search, $options: 'i' };
    }

    const tasks = await Task.find(filter)
      .populate('leadId')
      .populate('assignedAdvisorId', 'name email phone avatar role')
      .sort({ dueAt: 1 });

    return res.status(200).json({ success: true, data: { tasks } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createTask = async (req, res) => {
  try {
    const { title, description, leadId, priority, dueAt, assignedAdvisorId } = req.body;
    if (!title || !dueAt) {
      return res.status(400).json({ success: false, message: 'Title and due date are required.' });
    }

    const task = await Task.create({
      brokerageId: req.user.brokerageId,
      title,
      description: description || '',
      leadId: leadId || null,
      assignedAdvisorId: assignedAdvisorId || (req.user.role === 'advisor' ? req.user._id : null),
      priority: priority || 'medium',
      dueAt,
    });

    const populatedTask = await Task.findById(task._id)
      .populate('leadId')
      .populate('assignedAdvisorId', 'name email phone avatar role');

    return res.status(201).json({ success: true, data: populatedTask });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const completeTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { isCompleted } = req.body;

    const task = await Task.findOne({ _id: taskId, ...req.tenantFilter });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const newCompleted = typeof isCompleted !== 'undefined' ? Boolean(isCompleted) : !task.isCompleted;
    task.isCompleted = newCompleted;
    task.completedAt = newCompleted ? new Date() : null;
    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate('leadId')
      .populate('assignedAdvisorId', 'name email phone avatar role');

    return res.status(200).json({ success: true, data: populatedTask });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { title, description, leadId, priority, dueAt, assignedAdvisorId, isCompleted } = req.body;

    const task = await Task.findOne({ _id: taskId, ...req.tenantFilter });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    if (leadId !== undefined) task.leadId = leadId || null;
    if (priority !== undefined) task.priority = priority;
    if (dueAt !== undefined) task.dueAt = dueAt;
    if (assignedAdvisorId !== undefined) task.assignedAdvisorId = assignedAdvisorId || null;
    if (isCompleted !== undefined) {
      task.isCompleted = Boolean(isCompleted);
      task.completedAt = task.isCompleted ? (task.completedAt || new Date()) : null;
    }

    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate('leadId')
      .populate('assignedAdvisorId', 'name email phone avatar role');

    return res.status(200).json({ success: true, data: populatedTask });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteTask = async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await Task.findOneAndDelete({ _id: taskId, ...req.tenantFilter });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    return res.status(200).json({ success: true, message: 'Task deleted successfully', data: { taskId } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
