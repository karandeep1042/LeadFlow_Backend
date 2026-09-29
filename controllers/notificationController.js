import Notification from '../models/Notification.js';

/**
 * Helper to build strict role-isolated query filters
 */
const buildNotificationFilter = (brokerageId, userId, userRole, unreadOnly = false) => {
  const base = {};
  if (unreadOnly) {
    base.isRead = false;
  }

  // Platform Admin queries all platform-level alerts or direct user notifications across the system
  if (userRole === 'platform_admin') {
    return {
      ...base,
      $or: [
        { recipientId: userId },
        { recipientRole: 'platform_admin' },
        { recipientRole: 'all' },
      ],
    };
  }

  if (brokerageId) {
    base.brokerageId = brokerageId;
  }

  if (userRole === 'client') {
    return {
      ...base,
      $or: [
        { recipientId: userId },
        { recipientRole: 'client' },
      ],
    };
  }

  if (userRole === 'advisor') {
    return {
      ...base,
      $or: [
        { recipientId: userId },
        { recipientRole: 'advisor' },
        { recipientRole: 'all' },
      ],
    };
  }

  if (userRole === 'brokerage_admin') {
    return {
      ...base,
      $or: [
        { recipientId: userId },
        { recipientRole: 'brokerage_admin' },
        { recipientRole: 'all' },
      ],
    };
  }

  return {
    ...base,
    $or: [
      { recipientId: userId },
      { recipientRole: userRole },
      { recipientRole: 'all' },
    ],
  };
};

/**
 * Get notifications for the authenticated user based on user ID and role
 */
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const brokerageId = req.user.brokerageId;

    if (!brokerageId && userRole !== 'platform_admin') {
      return res.status(200).json({
        success: true,
        data: { notifications: [], unreadCount: 0 },
      });
    }

    const filter = buildNotificationFilter(brokerageId, userId, userRole, false);
    const unreadFilter = buildNotificationFilter(brokerageId, userId, userRole, true);

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
      Notification.countDocuments(unreadFilter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Mark a single notification as read
 */
export const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Mark all notifications as read for the current user
 */
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const brokerageId = req.user.brokerageId;

    if (!brokerageId && userRole !== 'platform_admin') {
      return res.status(200).json({ success: true, count: 0 });
    }

    const filter = buildNotificationFilter(brokerageId, userId, userRole, true);

    const result = await Notification.updateMany(filter, {
      $set: { isRead: true, readAt: new Date() },
    });

    return res.status(200).json({
      success: true,
      count: result.modifiedCount || 0,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Clear/Delete all notifications for the current user / role
 */
export const clearAllNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const brokerageId = req.user.brokerageId;

    if (!brokerageId && userRole !== 'platform_admin') {
      return res.status(200).json({ success: true, count: 0, message: 'No notifications to clear' });
    }

    const filter = buildNotificationFilter(brokerageId, userId, userRole, false);

    const result = await Notification.deleteMany(filter);

    return res.status(200).json({
      success: true,
      count: result.deletedCount || 0,
      message: 'All notifications cleared successfully',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Delete a single notification
 */
export const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notif = await Notification.findByIdAndDelete(notificationId);
    if (!notif) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    return res.status(200).json({ success: true, message: 'Notification removed' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

