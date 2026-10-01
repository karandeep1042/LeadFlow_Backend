import Task from '../models/Task.js';
import { emitToBrokerage } from '../utils/socket.js';
import { notifyTaskAssigned, notifyTaskCompleted } from '../services/notificationService.js';
import cacheService from '../services/cacheService.js';

export const invalidateTaskCaches = async (brokerageId) => {
  if (!brokerageId) return;
  try {
    await Promise.all([
      cacheService.invalidatePattern(cacheService.generateKey(brokerageId, 'tasks', '*')),
      cacheService.del(cacheService.generateKey(brokerageId, 'dash', 'stats')),
    ]);
  } catch (err) {
    console.warn('[Cache] Error invalidating task caches:', err.message);
  }
};

export const getTasks = async (req, res) => {
  try {
    const brokerageId = req.user?.brokerageId;
    const sortedQuery = Object.keys(req.query || {})
      .sort()
      .reduce((acc, key) => {
        acc[key] = req.query[key];
        return acc;
      }, {});
    const cacheKey = cacheService.generateKey(
      brokerageId,
      'tasks',
      `${req.user?.role}:${req.user?._id}:${JSON.stringify(sortedQuery)}`
    );

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    const { advisorId, isCompleted, priority, search, includeSuperseded, view = 'all' } = req.query;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const andConditions = [{ ...req.tenantFilter }];

    if (req.user.role === 'advisor') {
      // Mortgage Advisors see tasks assigned to them OR unassigned tasks within their brokerage
      andConditions.push({
        $or: [
          { assignedAdvisorId: req.user._id },
          { assignedAdvisorId: null },
          { assignedAdvisorId: { $exists: false } },
        ],
      });
    } else if (advisorId) {
      if (advisorId === 'unassigned') {
        andConditions.push({ assignedAdvisorId: null });
      } else {
        andConditions.push({ assignedAdvisorId: advisorId });
      }
    }

    if (includeSuperseded !== 'true') {
      // By default, exclude superseded tasks from inboxes
      andConditions.push({ status: { $ne: 'superseded' } });
    }

    if (typeof isCompleted !== 'undefined') {
      andConditions.push({ isCompleted: isCompleted === 'true' });
    }

    if (priority && priority !== 'all') {
      andConditions.push({ priority });
    }

    if (search) {
      andConditions.push({ title: { $regex: search, $options: 'i' } });
    }

    // View filter logic:
    // 'active': pending tasks OR tasks completed within the last 7 days
    // 'archive': tasks completed > 7 days ago
    // 'all': all tasks matching filters (preserves complete client-side tab switching & analytics)
    if (view === 'active' && typeof isCompleted === 'undefined') {
      andConditions.push({
        $or: [
          { isCompleted: false },
          { isCompleted: true, completedAt: { $gte: sevenDaysAgo } },
          { isCompleted: true, completedAt: null },
        ],
      });
    } else if (view === 'archive') {
      andConditions.push({
        isCompleted: true,
        $or: [
          { completedAt: { $lt: sevenDaysAgo } },
          { completedAt: null },
        ],
      });
    }

    const query = andConditions.length === 1 ? andConditions[0] : { $and: andConditions };

    const tasks = await Task.find(query)
      .populate('leadId')
      .populate('assignedAdvisorId', 'name email phone avatar role')
      .sort(view === 'archive' ? { completedAt: -1, updatedAt: -1 } : { dueAt: 1 });

    const responsePayload = { success: true, data: { tasks } };
    cacheService.set(cacheKey, responsePayload, 300).catch(() => {});
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getTaskAnalytics = async (req, res) => {
  try {
    const brokerageId = req.user?.brokerageId;
    const cacheKey = cacheService.generateKey(
      brokerageId,
      'tasks',
      `analytics:${req.user?.role}:${req.user?._id}`
    );

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json(cached);
    }

    const filter = { ...req.tenantFilter };
    if (req.user.role === 'advisor') {
      filter.$or = [
        { assignedAdvisorId: req.user._id },
        { assignedAdvisorId: null },
        { assignedAdvisorId: { $exists: false } },
      ];
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalTasks,
      pendingTasks,
      overdueTasks,
      dueTodayTasks,
      upcomingTasks,
      allCompletedTasks,
      recentCompleted7d,
      completed30d,
    ] = await Promise.all([
      Task.countDocuments(filter),
      Task.countDocuments({ ...filter, isCompleted: false }),
      Task.countDocuments({ ...filter, isCompleted: false, dueAt: { $lt: now } }),
      Task.countDocuments({ ...filter, isCompleted: false, dueAt: { $gte: startOfDay, $lte: endOfDay } }),
      Task.countDocuments({ ...filter, isCompleted: false, dueAt: { $gt: endOfDay } }),
      Task.find({ ...filter, isCompleted: true, status: { $ne: 'superseded' } }).select('createdAt dueAt completedAt priority stage assignedAdvisorId'),
      Task.countDocuments({ ...filter, isCompleted: true, completedAt: { $gte: sevenDaysAgo } }),
      Task.countDocuments({ ...filter, isCompleted: true, completedAt: { $gte: thirtyDaysAgo } }),
    ]);

    const totalCompleted = allCompletedTasks.length;
    const onTimeCompleted = allCompletedTasks.filter(
      (t) => t.completedAt && t.dueAt && new Date(t.completedAt) <= new Date(t.dueAt)
    ).length;
    const onTimeRate = totalCompleted > 0 ? Math.round((onTimeCompleted / totalCompleted) * 100) : 100;

    let totalResolutionHours = 0;
    let countedTasks = 0;
    allCompletedTasks.forEach((t) => {
      if (t.completedAt && t.createdAt) {
        const diffHours = Math.max(0.1, (new Date(t.completedAt) - new Date(t.createdAt)) / (1000 * 60 * 60));
        totalResolutionHours += diffHours;
        countedTasks += 1;
      }
    });
    const avgResolutionHours = countedTasks > 0 ? Number((totalResolutionHours / countedTasks).toFixed(1)) : 0;
    const archivedCount = Math.max(0, totalCompleted - recentCompleted7d);

    const responsePayload = {
      success: true,
      data: {
        totalTasks,
        pendingTasks,
        overdueTasks,
        dueTodayTasks,
        upcomingTasks,
        totalCompleted,
        recentCompleted7d,
        completed30d,
        archivedCount,
        onTimeRate,
        avgResolutionHours,
      },
    };

    cacheService.set(cacheKey, responsePayload, 300).catch(() => {});
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};


export const createTask = async (req, res) => {
  try {
    if (req.user.role === 'advisor') {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: Mortgage Advisors cannot manually create tasks. Tasks are generated automatically via stage workflows or assigned directly by Brokerage Administrators.',
      });
    }

    const { title, description, leadId, priority, dueAt, assignedAdvisorId, stage } = req.body;
    if (!title || !dueAt) {
      return res.status(400).json({ success: false, message: 'Title and due date are required.' });
    }

    const task = await Task.create({
      brokerageId: req.user.brokerageId,
      title,
      description: description || '',
      leadId: leadId || null,
      stage: stage || null,
      isAutoGenerated: false,
      status: 'pending',
      assignedAdvisorId: assignedAdvisorId || null,
      priority: priority || 'medium',
      dueAt,
    });

    const populatedTask = await Task.findById(task._id)
      .populate('leadId')
      .populate('assignedAdvisorId', 'name email phone avatar role');

    // Emit real-time task creation
    emitToBrokerage(req.user.brokerageId, 'task:created', populatedTask);

    // Notify assigned advisor
    if (populatedTask.assignedAdvisorId) {
      notifyTaskAssigned({
        brokerageId: req.user.brokerageId,
        task: populatedTask,
        lead: populatedTask.leadId,
        advisorId: populatedTask.assignedAdvisorId._id,
      });
    }

    await invalidateTaskCaches(req.user.brokerageId);

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

    // Advisors can only complete tasks assigned to them
    if (req.user.role === 'advisor') {
      const assignedId = task.assignedAdvisorId?.toString();
      if (!assignedId || assignedId !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access Denied: You can only complete tasks assigned to you.',
        });
      }
    }

    const newCompleted = typeof isCompleted !== 'undefined' ? Boolean(isCompleted) : !task.isCompleted;
    task.isCompleted = newCompleted;
    task.status = newCompleted ? 'completed' : 'pending';
    task.completedAt = newCompleted ? new Date() : null;
    task.completedReason = newCompleted ? 'user_completed' : null;
    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate('leadId')
      .populate('assignedAdvisorId', 'name email phone avatar role');

    // Real-time task update broadcast
    emitToBrokerage(req.user.brokerageId, 'task:updated', populatedTask);

    // If task was marked completed, notify admin
    if (newCompleted) {
      notifyTaskCompleted({
        brokerageId: req.user.brokerageId,
        task: populatedTask,
        lead: populatedTask.leadId,
        advisorName: req.user.name,
      });
    }

    await invalidateTaskCaches(req.user.brokerageId);

    return res.status(200).json({ success: true, data: populatedTask });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateTask = async (req, res) => {
  try {
    if (req.user.role === 'advisor') {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: Mortgage Advisors cannot edit task configurations. Task modifications are managed by Brokerage Administrators.',
      });
    }

    const { taskId } = req.params;
    const { title, description, leadId, priority, dueAt, assignedAdvisorId, isCompleted, stage } = req.body;

    const task = await Task.findOne({ _id: taskId, ...req.tenantFilter });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    if (leadId !== undefined) task.leadId = leadId || null;
    if (stage !== undefined) task.stage = stage || null;
    if (priority !== undefined) task.priority = priority;
    if (dueAt !== undefined) task.dueAt = dueAt;
    if (assignedAdvisorId !== undefined) task.assignedAdvisorId = assignedAdvisorId || null;
    if (isCompleted !== undefined) {
      task.isCompleted = Boolean(isCompleted);
      task.status = task.isCompleted ? 'completed' : 'pending';
      task.completedAt = task.isCompleted ? (task.completedAt || new Date()) : null;
      task.completedReason = task.isCompleted ? 'user_completed' : null;
    }

    await task.save();

    const populatedTask = await Task.findById(task._id)
      .populate('leadId')
      .populate('assignedAdvisorId', 'name email phone avatar role');

    emitToBrokerage(req.user.brokerageId, 'task:updated', populatedTask);

    await invalidateTaskCaches(req.user.brokerageId);

    return res.status(200).json({ success: true, data: populatedTask });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteTask = async (req, res) => {
  try {
    if (req.user.role === 'advisor') {
      return res.status(403).json({
        success: false,
        message: 'Access Denied: Mortgage Advisors cannot delete tasks.',
      });
    }

    const { taskId } = req.params;
    const task = await Task.findOneAndDelete({ _id: taskId, ...req.tenantFilter });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    emitToBrokerage(req.user.brokerageId, 'task:deleted', { taskId });

    await invalidateTaskCaches(req.user.brokerageId);

    return res.status(200).json({ success: true, message: 'Task deleted successfully', data: { taskId } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
