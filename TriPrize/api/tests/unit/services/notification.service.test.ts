import { NotificationService, NotificationType, NotificationPayload } from '../../../src/services/notification.service';
import { pool } from '../../../src/config/database.config';
import { getMessaging } from '../../../src/config/firebase.config';

// Mock dependencies
jest.mock('../../../src/config/database.config');
jest.mock('../../../src/config/firebase.config', () => ({
	  getMessaging: jest.fn(() => ({
	    send: jest.fn(),
	    subscribeToTopic: jest.fn(),
	    unsubscribeFromTopic: jest.fn(),
	  })),
	}));
jest.mock('../../../src/utils/logger.util', () => ({
	  info: jest.fn(),
	  error: jest.fn(),
	  warn: jest.fn(),
	  debug: jest.fn(),
	}));

type MessagingMock = {
	  send: jest.Mock;
	  subscribeToTopic: jest.Mock;
	  unsubscribeFromTopic: jest.Mock;
};

describe('NotificationService', () => {
	  let service: NotificationService;

	  beforeEach(() => {
	    service = new NotificationService();
	    (pool.query as jest.Mock) = jest.fn();
	  });

	  afterEach(() => {
	    jest.clearAllMocks();
	  });

  describe('sendToUser', () => {
    const userId = 'user-123';
    const type = NotificationType.PURCHASE_CONFIRMED;
    const payload: NotificationPayload = {
      title: 'Purchase Confirmed',
      body: 'Your purchase has been confirmed',
    };

	    it('should send notification successfully to a user with a valid token', async () => {
      const mockUser = {
        fcm_token: 'fcm-token-123',
        notification_enabled: true,
      };

	      (pool.query as jest.Mock).mockImplementation(async (query: string) => {
        if (query.startsWith('SELECT fcm_token')) {
          return { rows: [mockUser] };
        }
        return { rows: [] }; // For the INSERT log
      });

      await service.sendToUser(userId, type, payload);

	      const messagingMock = (getMessaging as unknown as jest.Mock).mock.results[0]
	        .value as MessagingMock;

	      expect(pool.query).toHaveBeenCalledWith(
	        'SELECT fcm_token, notification_enabled FROM users WHERE user_id = $1',
	        [userId]
	      );
	      expect(messagingMock.send).toHaveBeenCalledWith(
	        expect.objectContaining({
	          token: 'fcm-token-123',
	        })
	      );
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        expect.arrayContaining([userId, type, 'sent'])
      );
    });

	    it('should not send if user has notifications disabled', async () => {
      const mockUser = {
        fcm_token: 'fcm-token-123',
        notification_enabled: false,
      };
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockUser] });

	      await service.sendToUser(userId, type, payload);

	      const getMessagingMock = getMessaging as unknown as jest.Mock;
	      expect(getMessagingMock).not.toHaveBeenCalled();
	      expect(pool.query).not.toHaveBeenCalledWith(
	        expect.stringContaining('INSERT INTO notifications'),
	      );
    });

	    it('should not send if user has no FCM token', async () => {
      const mockUser = {
        fcm_token: null,
        notification_enabled: true,
      };
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [mockUser] });

	      await service.sendToUser(userId, type, payload);

	      const getMessagingMock = getMessaging as unknown as jest.Mock;
	      expect(getMessagingMock).not.toHaveBeenCalled();
    });

	    it('should log as failed and clear token on FCM error for invalid token', async () => {
      const mockUser = {
        fcm_token: 'invalid-token',
        notification_enabled: true,
      };
      const fcmError = new Error('Invalid token');
      (fcmError as any).code = 'messaging/registration-token-not-registered';

	      (pool.query as jest.Mock).mockImplementation(async (query: string, params?: unknown[]) => {
        if (query.startsWith('SELECT fcm_token')) {
          return { rows: [mockUser] };
        }
	        // For INSERT log and UPDATE users we just simulate successful execution
	        return { rows: [], query, params } as unknown;
      });

	      const getMessagingMock = getMessaging as unknown as jest.Mock;
	      const messagingMock: MessagingMock = {
	        send: jest.fn().mockRejectedValueOnce(fcmError),
	        subscribeToTopic: jest.fn(),
	        unsubscribeFromTopic: jest.fn(),
	      };
	      getMessagingMock.mockReturnValueOnce(messagingMock);
	
	      await service.sendToUser(userId, type, payload);

	      // Check that it tried to send
	      expect(messagingMock.send).toHaveBeenCalled();
      // Check that it logged the failure
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO notifications'),
        expect.arrayContaining([userId, type, 'failed'])
      );
      // Check that it cleared the invalid token
      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE users SET fcm_token = NULL WHERE user_id = $1',
        [userId]
      );
    });
  });

  describe('getUserNotifications', () => {
    it('should return user notifications', async () => {
      const mockNotifications = [
        {
          notification_id: 'notif-1',
          user_id: 'user-123',
          type: 'purchase_confirmed',
          title: 'Test',
          body: 'Test message',
          data: '{}',
          status: 'sent',
          created_at: new Date(),
        },
      ];

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockNotifications });

      const result = await service.getUserNotifications('user-123');

      expect(result).toHaveLength(1);
      expect(result[0].notification_id).toBe('notif-1');
    });
  });
});

