# Firebase Cloud Messaging 通知仕様

**日付**: 2025-11-11 | **フィーチャー**: [spec.md](../spec.md) | **関連**: FR-037, FR-038, FR-039

このドキュメントはFirebase Cloud Messaging (FCM) プッシュ通知のペイロード仕様を定義します。

---

## 概要

プッシュ通知は以下のタイミングで送信されます:

1. **購入確定時** - 決済成功（FR-038）
2. **コンビニ決済待ち** - 払込票発行後
3. **抽選実施時** - 全ポジション販売完了後（FR-038）
4. **当選通知** - 抽選結果確定後
5. **キャンペーン終了間近** - 終了1日前
6. **管理者メッセージ** - 管理者が任意送信

---

## FCMメッセージ構造

### 基本フォーマット

```typescript
interface FCMMessage {
  token: string;           // ユーザーのFCMトークン
  notification: {
    title: string;         // 通知タイトル（最大65文字）
    body: string;          // 通知本文（最大240文字）
    image?: string;        // 画像URL（オプション）
  };
  data: {                  // カスタムデータ（Deep Link用）
    notificationType: string;
    screen: string;
    [key: string]: string;
  };
  android: {
    priority: 'high' | 'normal';
    notification: {
      channelId: string;
      color: string;
      sound: string;
    };
  };
  apns: {
    headers: {
      'apns-priority': '10' | '5';
    };
    payload: {
      aps: {
        alert: {
          title: string;
          body: string;
        };
        badge?: number;
        sound: string;
      };
    };
  };
}
```

### 通知チャンネル（Android）

```kotlin
// Android notification channels
const val CHANNEL_PURCHASE = "purchase_notifications"
const val CHANNEL_LOTTERY = "lottery_notifications"
const val CHANNEL_CAMPAIGN = "campaign_notifications"
const val CHANNEL_ADMIN = "admin_notifications"
```

---

## 通知タイプ別仕様

### 1. purchase_confirmed（購入確定）

#### トリガー
Stripe Webhook `payment_intent.succeeded` 受信時

#### ペイロード

```json
{
  "token": "<user_fcm_token>",
  "notification": {
    "title": "購入が完了しました",
    "body": "キャンペーン「夏の大抽選会」のポジション購入が確定しました。",
    "image": "https://cdn.triprize.example.com/campaigns/campaign-id/thumb.jpg"
  },
  "data": {
    "notificationType": "purchase_confirmed",
    "screen": "purchase_detail",
    "purchaseId": "uuid-purchase-id",
    "campaignId": "uuid-campaign-id",
    "positionId": "uuid-position-id"
  },
  "android": {
    "priority": "high",
    "notification": {
      "channelId": "purchase_notifications",
      "color": "#4CAF50",
      "sound": "purchase_success"
    }
  },
  "apns": {
    "headers": {
      "apns-priority": "10"
    },
    "payload": {
      "aps": {
        "alert": {
          "title": "購入が完了しました",
          "body": "キャンペーン「夏の大抽選会」のポジション購入が確定しました。"
        },
        "badge": 1,
        "sound": "purchase_success.caf"
      }
    }
  }
}
```

#### Deep Link処理

```dart
// Flutter deep link handler
void handleDeepLink(Map<String, dynamic> data) {
  if (data['notificationType'] == 'purchase_confirmed') {
    Navigator.pushNamed(
      context,
      '/purchase-detail',
      arguments: {
        'purchaseId': data['purchaseId'],
        'campaignId': data['campaignId'],
      },
    );
  }
}
```

---

### 2. payment_pending（コンビニ決済待ち）

#### トリガー
コンビニ決済のPaymentIntent作成時（払込票発行後）

#### ペイロード

```json
{
  "token": "<user_fcm_token>",
  "notification": {
    "title": "コンビニでお支払いください",
    "body": "4日以内にファミリーマートでお支払いください。受付番号: 123-456-789"
  },
  "data": {
    "notificationType": "payment_pending",
    "screen": "payment_instructions",
    "purchaseId": "uuid-purchase-id",
    "paymentIntentId": "pi_stripe_id",
    "konbiniStore": "familymart",
    "confirmationNumber": "123-456-789",
    "paymentDeadline": "2025-11-15T23:59:59Z"
  },
  "android": {
    "priority": "high",
    "notification": {
      "channelId": "purchase_notifications",
      "color": "#FF9800",
      "sound": "default"
    }
  },
  "apns": {
    "headers": {
      "apns-priority": "10"
    },
    "payload": {
      "aps": {
        "alert": {
          "title": "コンビニでお支払いください",
          "body": "4日以内にファミリーマートでお支払いください。"
        },
        "sound": "default"
      }
    }
  }
}
```

#### 支払期限リマインダー

**送信タイミング**: 支払期限の24時間前

```json
{
  "notification": {
    "title": "お支払い期限が近づいています",
    "body": "明日23:59までにコンビニでお支払いください。受付番号: 123-456-789"
  },
  "data": {
    "notificationType": "payment_reminder",
    "screen": "payment_instructions",
    "purchaseId": "uuid-purchase-id"
  }
}
```

---

### 3. lottery_drawn（抽選実施）

#### トリガー
キャンペーン完売後、抽選実行完了時

#### ペイロード（参加者全員へ送信）

```json
{
  "token": "<user_fcm_token>",
  "notification": {
    "title": "抽選が実施されました",
    "body": "キャンペーン「夏の大抽選会」の抽選結果が発表されました。",
    "image": "https://cdn.triprize.example.com/campaigns/campaign-id/thumb.jpg"
  },
  "data": {
    "notificationType": "lottery_drawn",
    "screen": "lottery_results",
    "campaignId": "uuid-campaign-id"
  },
  "android": {
    "priority": "high",
    "notification": {
      "channelId": "lottery_notifications",
      "color": "#2196F3",
      "sound": "lottery_drawn"
    }
  },
  "apns": {
    "headers": {
      "apns-priority": "10"
    },
    "payload": {
      "aps": {
        "alert": {
          "title": "抽選が実施されました",
          "body": "キャンペーン「夏の大抽選会」の抽選結果が発表されました。"
        },
        "badge": 1,
        "sound": "lottery_drawn.caf"
      }
    }
  }
}
```

---

### 4. prize_won（当選通知）

#### トリガー
抽選実行後、当選者に対して送信

#### ペイロード

```json
{
  "token": "<user_fcm_token>",
  "notification": {
    "title": "🎉 おめでとうございます！",
    "body": "1等賞品「Nintendo Switch」に当選しました！",
    "image": "https://cdn.triprize.example.com/prizes/prize-id/image.jpg"
  },
  "data": {
    "notificationType": "prize_won",
    "screen": "prize_detail",
    "campaignId": "uuid-campaign-id",
    "prizeId": "uuid-prize-id",
    "prizeRank": "1",
    "prizeName": "Nintendo Switch"
  },
  "android": {
    "priority": "high",
    "notification": {
      "channelId": "lottery_notifications",
      "color": "#FFD700",
      "sound": "prize_won",
      "importance": "high",
      "vibrationPattern": [0, 500, 200, 500]
    }
  },
  "apns": {
    "headers": {
      "apns-priority": "10"
    },
    "payload": {
      "aps": {
        "alert": {
          "title": "🎉 おめでとうございます!",
          "body": "1等賞品「Nintendo Switch」に当選しました!"
        },
        "badge": 1,
        "sound": {
          "critical": 1,
          "name": "prize_won.caf",
          "volume": 1.0
        }
      }
    }
  }
}
```

---

### 5. campaign_ending（キャンペーン終了間近）

#### トリガー
キャンペーン終了の24時間前（Cron Job）

#### ペイロード（キャンペーンをフォロー中のユーザーへ送信）

```json
{
  "token": "<user_fcm_token>",
  "notification": {
    "title": "キャンペーン終了まで残り24時間",
    "body": "「夏の大抽選会」の販売は明日終了します。残りポジション: 15/100",
    "image": "https://cdn.triprize.example.com/campaigns/campaign-id/thumb.jpg"
  },
  "data": {
    "notificationType": "campaign_ending",
    "screen": "campaign_detail",
    "campaignId": "uuid-campaign-id"
  },
  "android": {
    "priority": "normal",
    "notification": {
      "channelId": "campaign_notifications",
      "color": "#FF5722",
      "sound": "default"
    }
  },
  "apns": {
    "headers": {
      "apns-priority": "5"
    },
    "payload": {
      "aps": {
        "alert": {
          "title": "キャンペーン終了まで残り24時間",
          "body": "「夏の大抽選会」の販売は明日終了します。"
        },
        "sound": "default"
      }
    }
  }
}
```

---

### 6. admin_message（管理者メッセージ）

#### トリガー
管理者が `/admin/notifications/send` エンドポイントから送信

#### ペイロード

```json
{
  "token": "<user_fcm_token>",
  "notification": {
    "title": "重要なお知らせ",
    "body": "システムメンテナンスのため、11/15 2:00-4:00の間サービスを停止します。",
    "image": "https://cdn.triprize.example.com/admin/maintenance.jpg"
  },
  "data": {
    "notificationType": "admin_message",
    "screen": "notification_detail",
    "notificationId": "uuid-notification-id",
    "priority": "high"
  },
  "android": {
    "priority": "high",
    "notification": {
      "channelId": "admin_notifications",
      "color": "#9C27B0",
      "sound": "default"
    }
  },
  "apns": {
    "headers": {
      "apns-priority": "10"
    },
    "payload": {
      "aps": {
        "alert": {
          "title": "重要なお知らせ",
          "body": "システムメンテナンスのため、11/15 2:00-4:00の間サービスを停止します。"
        },
        "sound": "default"
      }
    }
  }
}
```

---

## バックグラウンド処理

### Flutter バックグラウンドハンドラー

```dart
// main.dart
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();

  // データのみ通知の場合、ローカル通知を表示
  if (message.notification == null && message.data.isNotEmpty) {
    await _showLocalNotification(message);
  }

  // 通知タイプ別の処理
  final notificationType = message.data['notificationType'];
  switch (notificationType) {
    case 'purchase_confirmed':
      await _syncPurchaseData(message.data['purchaseId']);
      break;
    case 'lottery_drawn':
      await _syncLotteryResults(message.data['campaignId']);
      break;
    default:
      break;
  }
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();

  FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

  runApp(MyApp());
}
```

### フォアグラウンドハンドラー

```dart
// notification_service.dart
class NotificationService {
  void setupForegroundHandler() {
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      // フォアグラウンド時の通知表示
      if (message.notification != null) {
        _showInAppNotification(
          title: message.notification!.title!,
          body: message.notification!.body!,
          data: message.data,
        );
      }

      // データ処理
      _handleNotificationData(message.data);
    });
  }

  void setupNotificationTapHandler() {
    // 通知タップ時の処理（アプリ起動中）
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      _navigateToScreen(message.data);
    });

    // 通知タップ時の処理（アプリ終了状態から起動）
    FirebaseMessaging.instance.getInitialMessage().then((message) {
      if (message != null) {
        _navigateToScreen(message.data);
      }
    });
  }

  void _navigateToScreen(Map<String, dynamic> data) {
    final screen = data['screen'];
    switch (screen) {
      case 'purchase_detail':
        Get.toNamed('/purchase-detail', arguments: {
          'purchaseId': data['purchaseId'],
        });
        break;
      case 'lottery_results':
        Get.toNamed('/lottery-results', arguments: {
          'campaignId': data['campaignId'],
        });
        break;
      case 'prize_detail':
        Get.toNamed('/prize-detail', arguments: {
          'prizeId': data['prizeId'],
        });
        break;
      default:
        break;
    }
  }
}
```

---

## 通知許可リクエストのタイミング

### iOS許可戦略

**重要**: iOSの通知許可プロンプトは1回のみ。拒否後は設定アプリからしか変更不可。

#### 推奨タイミング: 初回購入完了後

```dart
// purchase_success_screen.dart
class PurchaseSuccessScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          // 購入完了UI
          SuccessAnimation(),
          Text('購入が完了しました'),

          // 通知許可リクエスト（カスタムダイアログ）
          _buildNotificationPrompt(),
        ],
      ),
    );
  }

  Widget _buildNotificationPrompt() {
    return Card(
      child: Column(
        children: [
          Icon(Icons.notifications_active, size: 48),
          Text('抽選結果をお知らせします'),
          Text('抽選が実施されたら、すぐに通知でお知らせします。'),
          ElevatedButton(
            onPressed: () async {
              // ユーザーが「許可する」をタップした場合のみ、システムプロンプトを表示
              final permission = await FirebaseMessaging.instance.requestPermission(
                alert: true,
                badge: true,
                sound: true,
              );

              if (permission.authorizationStatus == AuthorizationStatus.authorized) {
                // FCMトークンを取得してサーバーに送信
                final token = await FirebaseMessaging.instance.getToken();
                await _registerFCMToken(token);
              }
            },
            child: Text('通知を許可する'),
          ),
          TextButton(
            onPressed: () {
              // 「後で」を選択した場合、次回購入時に再度表示
              Navigator.pop(context);
            },
            child: Text('後で'),
          ),
        ],
      ),
    );
  }
}
```

---

## バッチ送信

### トピックベース送信

```typescript
// 大量ユーザーへの一斉送信（例: キャンペーン終了通知）
import admin from 'firebase-admin';

async function sendToTopic(topic: string, message: admin.messaging.Message) {
  const response = await admin.messaging().send({
    ...message,
    topic: topic,
  });
  console.log('Message sent to topic', topic, response);
}

// キャンペーン参加者全員に送信
await sendToTopic(`campaign_${campaignId}`, {
  notification: {
    title: '抽選が実施されました',
    body: 'キャンペーン「夏の大抽選会」の抽選結果が発表されました。',
  },
  data: {
    notificationType: 'lottery_drawn',
    campaignId: campaignId,
  },
});
```

### マルチキャスト送信（最大500トークン/リクエスト）

```typescript
async function sendToMultipleUsers(tokens: string[], message: admin.messaging.MulticastMessage) {
  // トークンを500件ずつに分割
  const batches = chunkArray(tokens, 500);

  for (const batch of batches) {
    const response = await admin.messaging().sendEachForMulticast({
      ...message,
      tokens: batch,
    });

    console.log(`${response.successCount} messages sent successfully`);
    console.log(`${response.failureCount} messages failed`);

    // 失敗したトークンを処理
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        console.error(`Failed to send to ${batch[idx]}:`, resp.error);

        // 無効なトークンをDBから削除
        if (resp.error?.code === 'messaging/invalid-registration-token' ||
            resp.error?.code === 'messaging/registration-token-not-registered') {
          deleteInvalidToken(batch[idx]);
        }
      }
    });
  }
}
```

---

## エラーハンドリング

### 無効なFCMトークンの処理

```typescript
async function handleInvalidToken(userId: string, token: string, errorCode: string) {
  if (errorCode === 'messaging/invalid-registration-token' ||
      errorCode === 'messaging/registration-token-not-registered') {
    // DBから無効なトークンを削除
    await db.query(`
      UPDATE users
      SET fcm_token = NULL
      WHERE user_id = $1 AND fcm_token = $2
    `, [userId, token]);

    console.log(`Removed invalid token for user ${userId}`);
  }
}
```

### 送信失敗のリトライ

```typescript
async function sendWithRetry(
  token: string,
  message: admin.messaging.Message,
  maxRetries: number = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await admin.messaging().send({ ...message, token });
      return;
    } catch (error: any) {
      if (attempt === maxRetries) {
        throw error;
      }

      // 再試行可能なエラーの場合のみリトライ
      if (error.code === 'messaging/server-unavailable' ||
          error.code === 'messaging/internal-error') {
        await sleep(1000 * attempt); // 指数バックオフ
      } else {
        throw error; // 再試行不可能なエラー
      }
    }
  }
}
```

---

## テスト

### ローカルテスト（Firebase Console使用）

1. Firebase Console > Cloud Messaging
2. 「Send test message」を選択
3. FCMトークンを入力
4. 通知内容とデータを入力して送信

### ユニットテスト

```typescript
// tests/unit/notification.service.test.ts
import { describe, it, expect, jest } from '@jest/globals';
import { NotificationService } from '../src/services/notification.service';
import admin from 'firebase-admin';

jest.mock('firebase-admin');

describe('NotificationService', () => {
  it('should send purchase_confirmed notification', async () => {
    const mockSend = jest.spyOn(admin.messaging(), 'send');
    mockSend.mockResolvedValue('message-id');

    const service = new NotificationService();
    await service.sendPurchaseConfirmed({
      userId: 'test-user-id',
      purchaseId: 'test-purchase-id',
      campaignName: 'Test Campaign',
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({
          title: '購入が完了しました',
        }),
        data: expect.objectContaining({
          notificationType: 'purchase_confirmed',
          purchaseId: 'test-purchase-id',
        }),
      })
    );
  });
});
```

---

## パフォーマンス要件

- **送信レイテンシ**: p95 < 1秒（FCM API呼び出し）
- **配信成功率**: > 98%
- **バッチ送信**: 500トークン/リクエストを活用
- **非同期処理**: 通知送信はバックグラウンドジョブで実行（APIレスポンスをブロックしない）

---

## 次のステップ

Phase 1の残りの成果物:

1. **クイックスタート**: ローカル開発環境セットアップ手順（`quickstart.md`）

---

**作成者**: Claude Code | **レビュー**: Phase 1完了後に技術リードが確認
