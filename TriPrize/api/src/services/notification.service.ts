import { getMessaging } from '../config/firebase.config';
import { pool } from '../config/database.config';
import logger from '../utils/logger.util';
import * as admin from 'firebase-admin';

/**
 * Database row types for notification queries
 */
interface UserFcmRow {
  fcm_token: string | null;
  notification_enabled: boolean;
}

interface UserIdRow {
  user_id: string;
}

interface NotificationRow {
  notification_id: string;
  type: string;
  title: string;
  body: string;
  data: string;
  status: string;
  created_at: Date;
}

/**
 * Notification types
 */
export enum NotificationType {
  PURCHASE_CONFIRMED = 'purchase_confirmed',
  PAYMENT_COMPLETED = 'payment_completed',
  PAYMENT_FAILED = 'payment_failed',
  CAMPAIGN_CLOSED = 'campaign_closed',
  LOTTERY_DRAWN = 'lottery_drawn',
  PRIZE_WON = 'prize_won',
  ADMIN_ANNOUNCEMENT = 'admin_announcement',
}

/**
 * Notification payload
 */
export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

/**
 * Notification service for sending push notifications via FCM
 */
export class NotificationService {
  /**
   * Send notification to a single user
   */
  async sendToUser(
    userId: string,
    type: NotificationType,
    payload: NotificationPayload
  ): Promise<void> {
    try {
      // Get user's FCM token
      const { rows } = await pool.query<UserFcmRow>(
        'SELECT fcm_token, notification_enabled FROM users WHERE user_id = $1',
        [userId]
      );

      if (rows.length === 0) {
        logger.warn('User not found for notification', { userId });
        return;
      }

      const user = rows[0];

      if (!user.notification_enabled) {
        logger.debug('Notifications disabled for user', { userId });
        return;
      }

      if (!user.fcm_token) {
        logger.debug('No FCM token for user', { userId });
        return;
      }

      // Send FCM message
      const message: admin.messaging.Message = {
        token: user.fcm_token,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.imageUrl && { imageUrl: payload.imageUrl }),
        },
        data: {
          type,
          ...(payload.data || {}),
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const messaging = getMessaging();
      if (!messaging) {
        logger.warn('Firebase messaging not available - skipping notification');
        await this.logNotification(userId, type, payload, 'failed');
        return;
      }

      const response = await messaging.send(message);

      // Log notification in database
      await this.logNotification(userId, type, payload, 'sent');

      logger.info('Notification sent', { userId, type, messageId: response });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to send notification', {
        error: errorMessage,
        userId,
        type,
      });

      // Log failed notification
      await this.logNotification(userId, type, payload, 'failed');

      // Handle invalid token
      const errorCode = error && typeof error === 'object' && 'code' in error
        ? (error as { code: string }).code
        : undefined;

      if (
        errorCode === 'messaging/invalid-registration-token' ||
        errorCode === 'messaging/registration-token-not-registered'
      ) {
        logger.warn('Invalid FCM token, clearing from database', { userId });
        await pool.query(
          'UPDATE users SET fcm_token = NULL WHERE user_id = $1',
          [userId]
        );
      }
    }
  }

  /**
   * Send notification to multiple users
   */
  async sendToUsers(
    userIds: string[],
    type: NotificationType,
    payload: NotificationPayload
  ): Promise<void> {
    const promises = userIds.map((userId) =>
      this.sendToUser(userId, type, payload)
    );

    await Promise.allSettled(promises);
  }

  /**
   * Send notification to all users (broadcast)
   */
  async sendToAll(type: NotificationType, payload: NotificationPayload): Promise<void> {
    try {
      const { rows } = await pool.query<UserIdRow>(
        'SELECT user_id FROM users WHERE notification_enabled = TRUE AND fcm_token IS NOT NULL'
      );

      const userIds = rows.map((row) => String(row.user_id));

      logger.info(`Broadcasting notification to ${userIds.length} users`, { type });

      await this.sendToUsers(userIds, type, payload);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to broadcast notification', {
        error: errorMessage,
        type,
      });
    }
  }

  /**
   * Send notification to topic subscribers
   */
  async sendToTopic(
    topic: string,
    type: NotificationType,
    payload: NotificationPayload
  ): Promise<void> {
    try {
      const message: admin.messaging.Message = {
        topic,
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.imageUrl && { imageUrl: payload.imageUrl }),
        },
        data: {
          type,
          ...(payload.data || {}),
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const messaging = getMessaging();
      if (!messaging) {
        logger.warn('Firebase messaging not available - skipping topic notification');
        return;
      }

      const response = await messaging.send(message);

      logger.info('Topic notification sent', { topic, type, messageId: response });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to send topic notification', {
        error: errorMessage,
        topic,
        type,
      });
    }
  }

  /**
   * Subscribe user to topic
   */
  async subscribeToTopic(userId: string, topic: string): Promise<void> {
    try {
      const { rows } = await pool.query<UserFcmRow>(
        'SELECT fcm_token FROM users WHERE user_id = $1',
        [userId]
      );

      if (rows.length === 0 || !rows[0].fcm_token) {
        logger.warn('Cannot subscribe to topic: no FCM token', { userId, topic });
        return;
      }

      const fcmToken = String(rows[0].fcm_token);
      const messaging = getMessaging();
      if (!messaging) {
        logger.warn('Firebase messaging not available - cannot subscribe to topic');
        return;
      }

      await messaging.subscribeToTopic([fcmToken], topic);

      logger.info('User subscribed to topic', { userId, topic });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to subscribe to topic', {
        error: errorMessage,
        userId,
        topic,
      });
    }
  }

  /**
   * Unsubscribe user from topic
   */
  async unsubscribeFromTopic(userId: string, topic: string): Promise<void> {
    try {
      const { rows } = await pool.query<UserFcmRow>(
        'SELECT fcm_token FROM users WHERE user_id = $1',
        [userId]
      );

      if (rows.length === 0 || !rows[0].fcm_token) {
        logger.warn('Cannot unsubscribe from topic: no FCM token', { userId, topic });
        return;
      }

      const fcmToken = String(rows[0].fcm_token);
      const messaging = getMessaging();
      if (!messaging) {
        logger.warn('Firebase messaging not available - cannot unsubscribe from topic');
        return;
      }

      await messaging.unsubscribeFromTopic([fcmToken], topic);

      logger.info('User unsubscribed from topic', { userId, topic });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to unsubscribe from topic', {
        error: errorMessage,
        userId,
        topic,
      });
    }
  }

  /**
   * Log notification to database
   */
  private async logNotification(
    userId: string,
    type: NotificationType,
    payload: NotificationPayload,
    status: 'sent' | 'failed'
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, data, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          userId,
          type,
          payload.title,
          payload.body,
          JSON.stringify(payload.data || {}),
          status,
        ]
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to log notification', {
        error: errorMessage,
        userId,
        type,
      });
    }
  }

  /**
   * Get notification history for user
   */
  async getUserNotifications(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Array<{
    notification_id: string;
    type: string;
    title: string;
    body: string;
    data: string;
    status: string;
    created_at: Date;
  }>> {
    try {
      const { rows } = await pool.query<NotificationRow>(
        `SELECT notification_id, type, title, body, data, status, created_at
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      return rows.map((row) => ({
        notification_id: String(row.notification_id),
        type: String(row.type),
        title: String(row.title),
        body: String(row.body),
        data: String(row.data),
        status: String(row.status),
        created_at: new Date(row.created_at),
      }));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get user notifications', {
        error: errorMessage,
        userId,
      });
      throw error;
    }
  }
}

export default new NotificationService();
