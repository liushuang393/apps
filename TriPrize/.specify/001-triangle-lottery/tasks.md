# Tasks: 三角形抽選販売アプリケーション

**Input**: Design documents from `/specs/001-triangle-lottery/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Tests are NOT explicitly requested in the specification, so test tasks are excluded. Focus on implementation tasks only.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

---

## Format: `- [ ] [ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Path Conventions (from plan.md)

- **API**: `api/src/`
- **Mobile**: `mobile/lib/`
- **Shared**: `shared/types/`
- **Infra**: `infra/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [ ] T001 Create monorepo structure with api/, mobile/, shared/, and infra/ directories
- [ ] T002 Initialize Node.js API project with package.json, TypeScript 5.x, Express.js dependencies
- [ ] T003 Initialize Flutter mobile project with pubspec.yaml, Flutter 3.16+, Dart 3.2+
- [ ] T004 [P] Configure ESLint and Prettier for API in api/.eslintrc.json and api/.prettierrc
- [ ] T005 [P] Configure Dart analyzer strict mode in mobile/analysis_options.yaml
- [ ] T006 [P] Create .env.example files for api/.env.example and mobile/.env.example
- [ ] T007 [P] Setup .gitignore for Node.js, Flutter, and environment files
- [ ] T008 Create README.md with project overview and setup instructions
- [ ] T009 [P] Setup pre-commit hooks with Husky for linting and formatting in .husky/pre-commit

**Checkpoint**: Basic project structure is ready

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Database & Storage

- [ ] T010 Create PostgreSQL migration framework in api/migrations/001_initial_schema.sql
- [ ] T011 [P] Create database configuration in api/src/config/database.config.ts with connection pool settings
- [ ] T012 [P] Create Redis configuration in api/src/config/redis.config.ts
- [ ] T013 Implement database migration runner script in api/src/utils/migrate.ts
- [ ] T014 Create seed data script for development in api/src/utils/seed.ts

### Authentication & Authorization

- [ ] T015 [P] Create Firebase Admin SDK configuration in api/src/config/firebase.config.ts
- [ ] T016 [P] Implement Firebase Authentication middleware in api/src/middleware/auth.middleware.ts
- [ ] T017 [P] Create role-based authorization middleware in api/src/middleware/role.middleware.ts
- [ ] T018 Create User entity in api/src/models/user.entity.ts
- [ ] T019 Implement User service for profile management in api/src/services/user.service.ts

### API Infrastructure

- [ ] T020 [P] Create Express app setup in api/src/app.ts with middleware chain
- [ ] T021 [P] Implement request validation middleware in api/src/middleware/validation.middleware.ts
- [ ] T022 [P] Implement rate limiting middleware in api/src/middleware/rate-limit.middleware.ts
- [ ] T023 [P] Implement error handler middleware in api/src/middleware/error-handler.middleware.ts
- [ ] T024 [P] Create logger utility with Winston in api/src/utils/logger.util.ts
- [ ] T025 [P] Create crypto utility for hashing in api/src/utils/crypto.util.ts
- [ ] T026 Create idempotency service with Redis in api/src/services/idempotency.service.ts
- [ ] T027 Create API main entry point in api/src/index.ts

### External Integrations

- [ ] T028 [P] Create Stripe configuration in api/src/config/stripe.config.ts
- [ ] T029 [P] Create AWS S3 configuration in api/src/config/s3.config.ts
- [ ] T030 [P] Implement S3 image upload utility in api/src/utils/s3-upload.util.ts
- [ ] T031 [P] Implement notification service for FCM in api/src/services/notification.service.ts

### Mobile Infrastructure

- [ ] T032 [P] Create Flutter app entry point in mobile/lib/main.dart with Firebase initialization
- [ ] T033 [P] Create app router configuration in mobile/lib/app.dart
- [ ] T034 [P] Setup dependency injection with get_it in mobile/lib/core/di/injection.dart
- [ ] T035 [P] Create API client with Dio in mobile/lib/core/network/api_client.dart
- [ ] T036 [P] Create secure storage wrapper in mobile/lib/core/storage/secure_storage.dart
- [ ] T037 [P] Create theme configuration in mobile/lib/shared/theme/app_theme.dart
- [ ] T038 [P] Create constants file in mobile/lib/core/constants/app_constants.dart
- [ ] T039 [P] Setup Firebase Messaging handler in mobile/lib/core/utils/fcm_handler.dart

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - キャンペーン作成と管理 (Priority: P1) 🎯 MVP

**Goal**: 管理者が三角形抽選キャンペーンを作成し、底辺長さ、価格設定、賞品を管理できる

**Independent Test**: 管理者がログインし、キャンペーンパラメータを入力して保存することで、キャンペーンが作成され、利益計算が表示されることを確認

### API Implementation - US1

- [ ] T040 [P] [US1] Create Campaign entity in api/src/models/campaign.entity.ts with all fields from data-model.md
- [ ] T041 [P] [US1] Create Layer entity in api/src/models/layer.entity.ts
- [ ] T042 [P] [US1] Create Position entity in api/src/models/position.entity.ts
- [ ] T043 [P] [US1] Create Prize entity in api/src/models/prize.entity.ts
- [ ] T044 [US1] Create position calculator utility in api/src/utils/position-calculator.util.ts for triangular number calculation
- [ ] T045 [US1] Implement Campaign service in api/src/services/campaign.service.ts with CRUD operations
- [ ] T046 [US1] Add campaign creation logic with automatic layer/position generation in campaign.service.ts
- [ ] T047 [US1] Add profit margin calculation logic in campaign.service.ts
- [ ] T048 [US1] Add 15% profit margin warning validation in campaign.service.ts
- [ ] T049 [US1] Implement Campaign controller in api/src/controllers/campaign.controller.ts
- [ ] T050 [US1] Create campaign routes in api/src/routes/campaign.routes.ts for POST /api/v1/campaigns
- [ ] T051 [US1] Add GET /api/v1/campaigns endpoint for listing campaigns in campaign.routes.ts
- [ ] T052 [US1] Add GET /api/v1/campaigns/:id endpoint for campaign details in campaign.routes.ts
- [ ] T053 [US1] Add PUT /api/v1/campaigns/:id endpoint for updating campaigns in campaign.routes.ts
- [ ] T054 [US1] Add DELETE /api/v1/campaigns/:id endpoint for deleting draft campaigns in campaign.routes.ts
- [ ] T055 [US1] Add POST /api/v1/campaigns/:id/publish endpoint for publishing campaigns in campaign.routes.ts
- [ ] T056 [US1] Add validation for FR-008 (prevent price/prize changes after publish) in campaign.service.ts

### Mobile Implementation - US1

- [ ] T057 [P] [US1] Create Campaign domain entity in mobile/lib/features/campaign/domain/entities/campaign.dart
- [ ] T058 [P] [US1] Create Layer domain entity in mobile/lib/features/campaign/domain/entities/layer.dart
- [ ] T059 [P] [US1] Create Prize domain entity in mobile/lib/features/campaign/domain/entities/prize.dart
- [ ] T060 [P] [US1] Create Campaign DTO models in mobile/lib/features/campaign/data/models/campaign_model.dart
- [ ] T061 [P] [US1] Create Campaign repository interface in mobile/lib/features/campaign/domain/repositories/campaign_repository.dart
- [ ] T062 [US1] Implement Campaign repository in mobile/lib/features/campaign/data/repositories/campaign_repository_impl.dart
- [ ] T063 [US1] Create Campaign remote data source in mobile/lib/features/campaign/data/datasources/campaign_remote_datasource.dart
- [ ] T064 [P] [US1] Create GetCampaigns use case in mobile/lib/features/campaign/domain/usecases/get_campaigns.dart
- [ ] T065 [P] [US1] Create GetCampaignDetail use case in mobile/lib/features/campaign/domain/usecases/get_campaign_detail.dart
- [ ] T066 [P] [US1] Create CreateCampaign use case in mobile/lib/features/campaign/domain/usecases/create_campaign.dart
- [ ] T067 [US1] Create Campaign BLoC in mobile/lib/features/campaign/presentation/bloc/campaign_bloc.dart
- [ ] T068 [US1] Create campaign list screen in mobile/lib/features/campaign/presentation/pages/campaign_list_page.dart
- [ ] T069 [US1] Create campaign detail screen in mobile/lib/features/campaign/presentation/pages/campaign_detail_page.dart
- [ ] T070 [US1] Create campaign creation screen for admin in mobile/lib/features/admin/presentation/pages/create_campaign_page.dart
- [ ] T071 [US1] Create campaign form widget in mobile/lib/features/admin/presentation/widgets/campaign_form.dart
- [ ] T072 [US1] Create triangle visualization widget in mobile/lib/features/campaign/presentation/widgets/triangle_widget.dart

**Checkpoint**: User Story 1 complete - Campaign creation and management fully functional

---

## Phase 4: User Story 2 - ポジション購入 (Priority: P1) 🎯 MVP

**Goal**: ユーザーが公開中キャンペーンを閲覧し、層を選択して購入できる

**Independent Test**: ユーザーがアプリを開き、キャンペーンを選択し、層を選んで支払いを完了し、ポジション番号を確認できることを検証

### API Implementation - US2

- [ ] T073 [P] [US2] Create Purchase entity in api/src/models/purchase.entity.ts
- [ ] T074 [US2] Implement Purchase service in api/src/services/purchase.service.ts with transaction management
- [ ] T075 [US2] Add position allocation logic with REPEATABLE READ + FOR UPDATE SKIP LOCKED in purchase.service.ts
- [ ] T076 [US2] Add purchase limit validation (FR-012, FR-013) in purchase.service.ts
- [ ] T077 [US2] Add idempotency check using idempotency.service.ts in purchase.service.ts
- [ ] T078 [US2] Add automatic layer/campaign stats update in purchase.service.ts
- [ ] T079 [US2] Implement Purchase controller in api/src/controllers/purchase.controller.ts
- [ ] T080 [US2] Create purchase routes in api/src/routes/purchase.routes.ts for POST /api/v1/purchases
- [ ] T081 [US2] Add GET /api/v1/purchases endpoint for user purchase history in purchase.routes.ts
- [ ] T082 [US2] Add GET /api/v1/purchases/:id endpoint for purchase details in purchase.routes.ts
- [ ] T083 [US2] Add DELETE /api/v1/purchases/:id endpoint for canceling purchases in purchase.routes.ts
- [ ] T084 [US2] Add GET /api/v1/campaigns/:id/positions endpoint for viewing positions in campaign.routes.ts

### Mobile Implementation - US2

- [ ] T085 [P] [US2] Create Position domain entity in mobile/lib/features/purchase/domain/entities/position.dart
- [ ] T086 [P] [US2] Create Purchase domain entity in mobile/lib/features/purchase/domain/entities/purchase.dart
- [ ] T087 [P] [US2] Create Purchase DTO models in mobile/lib/features/purchase/data/models/purchase_model.dart
- [ ] T088 [P] [US2] Create Purchase repository interface in mobile/lib/features/purchase/domain/repositories/purchase_repository.dart
- [ ] T089 [US2] Implement Purchase repository in mobile/lib/features/purchase/data/repositories/purchase_repository_impl.dart
- [ ] T090 [US2] Create Purchase remote data source in mobile/lib/features/purchase/data/datasources/purchase_remote_datasource.dart
- [ ] T091 [P] [US2] Create PurchasePosition use case in mobile/lib/features/purchase/domain/usecases/purchase_position.dart
- [ ] T092 [P] [US2] Create GetPurchaseHistory use case in mobile/lib/features/purchase/domain/usecases/get_purchase_history.dart
- [ ] T093 [US2] Create Purchase BLoC in mobile/lib/features/purchase/presentation/bloc/purchase_bloc.dart
- [ ] T094 [US2] Create layer selection screen in mobile/lib/features/purchase/presentation/pages/layer_selection_page.dart
- [ ] T095 [US2] Create purchase confirmation screen in mobile/lib/features/purchase/presentation/pages/purchase_confirmation_page.dart
- [ ] T096 [US2] Create purchase history screen in mobile/lib/features/purchase/presentation/pages/purchase_history_page.dart
- [ ] T097 [US2] Add UUID generation for idempotency keys in mobile/lib/core/utils/uuid_generator.dart

**Checkpoint**: User Story 2 complete - Position purchase fully functional

---

## Phase 5: User Story 4 - 同時購入制御 (Priority: P1) 🎯 MVP

**Goal**: 複数ユーザーの同時購入でデータ整合性を保証し、オーバーセリングを防止

**Independent Test**: 負荷テストで同時購入リクエストを送信し、データベース制約が正しく機能することを確認

**Note**: This story is primarily implemented in Phase 4 (US2) through database transaction management. Additional tasks focus on error handling and recovery.

### API Implementation - US4

- [ ] T098 [US4] Add concurrent purchase error handling in purchase.service.ts
- [ ] T099 [US4] Add lock timeout handling in purchase.service.ts
- [ ] T100 [US4] Add transaction rollback on database errors in purchase.service.ts
- [ ] T101 [US4] Add automatic refund trigger on position allocation failure in purchase.service.ts
- [ ] T102 [US4] Add sold-out error response when no positions available in purchase.controller.ts
- [ ] T103 [US4] Create load testing script in api/tests/load/concurrent-purchase.k6.js

### Mobile Implementation - US4

- [ ] T104 [US4] Add sold-out error handling in Purchase BLoC
- [ ] T105 [US4] Add retry logic with exponential backoff in purchase_remote_datasource.dart
- [ ] T106 [US4] Create error dialog for concurrent purchase failures in mobile/lib/shared/widgets/error_dialog.dart

**Checkpoint**: User Story 4 complete - Concurrent purchase control fully functional

---

## Phase 6: User Story 5 - 日本決済手段対応 (Priority: P1) 🎯 MVP

**Goal**: クレジットカード、デビットカード、コンビニ決済で安全に支払いを完了できる

**Independent Test**: Stripeテストモードで各決済手段をシミュレートし、成功/失敗シナリオを検証

### API Implementation - US5

- [ ] T107 [P] [US5] Create PaymentTransaction entity in api/src/models/payment-transaction.entity.ts
- [ ] T108 [US5] Implement Payment service in api/src/services/payment.service.ts with Stripe integration
- [ ] T109 [US5] Add credit card payment intent creation in payment.service.ts
- [ ] T110 [US5] Add debit card payment support in payment.service.ts
- [ ] T111 [US5] Add konbini payment intent creation with 4-day expiry in payment.service.ts
- [ ] T112 [US5] Add payment method validation in payment.service.ts
- [ ] T113 [US5] Implement Payment controller in api/src/controllers/payment.controller.ts
- [ ] T114 [US5] Create payment routes in api/src/routes/payment.routes.ts for POST /api/v1/payments/intent
- [ ] T115 [US5] Add GET /api/v1/payments/:id endpoint for payment status in payment.routes.ts
- [ ] T116 [US5] Create webhook routes in api/src/routes/webhook.routes.ts for POST /api/webhooks/stripe
- [ ] T117 [US5] Implement Stripe webhook handler in api/src/controllers/webhook.controller.ts
- [ ] T118 [US5] Add webhook signature verification in webhook.controller.ts
- [ ] T119 [US5] Add payment_intent.succeeded handler in webhook.controller.ts
- [ ] T120 [US5] Add payment_intent.payment_failed handler in webhook.controller.ts
- [ ] T121 [US5] Add payment_intent.canceled handler in webhook.controller.ts
- [ ] T122 [US5] Add position status update on payment success in webhook.controller.ts
- [ ] T123 [US5] Add automatic refund on payment failure in webhook.controller.ts
- [ ] T124 [US5] Create cron job for konbini payment expiration in api/src/jobs/expire-konbini-payments.job.ts

### Mobile Implementation - US5

- [ ] T125 [P] [US5] Create Payment domain entity in mobile/lib/features/payment/domain/entities/payment.dart
- [ ] T126 [P] [US5] Create Payment DTO models in mobile/lib/features/payment/data/models/payment_model.dart
- [ ] T127 [P] [US5] Create Payment repository interface in mobile/lib/features/payment/domain/repositories/payment_repository.dart
- [ ] T128 [US5] Implement Payment repository in mobile/lib/features/payment/data/repositories/payment_repository_impl.dart
- [ ] T129 [US5] Create Payment remote data source in mobile/lib/features/payment/data/datasources/payment_remote_datasource.dart
- [ ] T130 [P] [US5] Create CreatePaymentIntent use case in mobile/lib/features/payment/domain/usecases/create_payment_intent.dart
- [ ] T131 [P] [US5] Create GetPaymentStatus use case in mobile/lib/features/payment/domain/usecases/get_payment_status.dart
- [ ] T132 [US5] Create Payment BLoC in mobile/lib/features/payment/presentation/bloc/payment_bloc.dart
- [ ] T133 [US5] Create payment method selection screen in mobile/lib/features/payment/presentation/pages/payment_method_page.dart
- [ ] T134 [US5] Create credit card payment screen with Stripe Elements in mobile/lib/features/payment/presentation/pages/card_payment_page.dart
- [ ] T135 [US5] Create konbini payment instructions screen in mobile/lib/features/payment/presentation/pages/konbini_payment_page.dart
- [ ] T136 [US5] Add Stripe Flutter SDK integration in pubspec.yaml and payment flow
- [ ] T137 [US5] Create payment success screen in mobile/lib/features/payment/presentation/pages/payment_success_page.dart
- [ ] T138 [US5] Create payment failure screen in mobile/lib/features/payment/presentation/pages/payment_failure_page.dart

**Checkpoint**: User Story 5 complete - Japanese payment methods fully functional. MVP COMPLETE at this checkpoint.

---

## Phase 7: User Story 3 - 進捗確認と抽選結果 (Priority: P2)

**Goal**: ユーザーが販売進捗をリアルタイム確認し、自動開奖された結果を閲覧できる

**Independent Test**: 既存の購入データを使って、進捗表示と開奖結果表示が正しく動作することを確認

### API Implementation - US3

- [ ] T139 [US3] Implement Lottery service in api/src/services/lottery.service.ts with Advisory Lock
- [ ] T140 [US3] Add lottery execution logic with random winner selection in lottery.service.ts
- [ ] T141 [US3] Add lottery idempotency with status flag checks in lottery.service.ts
- [ ] T142 [US3] Add automatic lottery trigger on sold-out in purchase.service.ts (update webhook handler)
- [ ] T143 [US3] Add winner notification logic in lottery.service.ts
- [ ] T144 [US3] Implement Lottery controller in api/src/controllers/lottery.controller.ts
- [ ] T145 [US3] Create lottery routes in api/src/routes/lottery.routes.ts for POST /api/v1/lottery/:campaignId/draw
- [ ] T146 [US3] Add GET /api/v1/lottery/:campaignId/results endpoint in lottery.routes.ts
- [ ] T147 [US3] Add GET /api/v1/users/me/campaigns endpoint for user's campaigns in user.routes.ts
- [ ] T148 [US3] Create Notification entity in api/src/models/notification.entity.ts
- [ ] T149 [US3] Add notification creation on purchase confirmed in notification.service.ts
- [ ] T150 [US3] Add notification creation on lottery drawn in notification.service.ts
- [ ] T151 [US3] Add notification creation on prize won in notification.service.ts
- [ ] T152 [US3] Add FCM message sending logic in notification.service.ts
- [ ] T153 [US3] Create notification routes in api/src/routes/notification.routes.ts for GET /api/v1/notifications
- [ ] T154 [US3] Add POST /api/v1/notifications/:id/read endpoint in notification.routes.ts
- [ ] T155 [US3] Add POST /api/v1/notifications/register-token endpoint for FCM tokens in notification.routes.ts

### Mobile Implementation - US3

- [ ] T156 [P] [US3] Create LotteryResult domain entity in mobile/lib/features/lottery/domain/entities/lottery_result.dart
- [ ] T157 [P] [US3] Create Winner domain entity in mobile/lib/features/lottery/domain/entities/winner.dart
- [ ] T158 [P] [US3] Create Notification domain entity in mobile/lib/features/lottery/domain/entities/notification.dart
- [ ] T159 [P] [US3] Create Lottery DTO models in mobile/lib/features/lottery/data/models/lottery_model.dart
- [ ] T160 [P] [US3] Create Lottery repository interface in mobile/lib/features/lottery/domain/repositories/lottery_repository.dart
- [ ] T161 [US3] Implement Lottery repository in mobile/lib/features/lottery/data/repositories/lottery_repository_impl.dart
- [ ] T162 [US3] Create Lottery remote data source in mobile/lib/features/lottery/data/datasources/lottery_remote_datasource.dart
- [ ] T163 [P] [US3] Create GetLotteryResults use case in mobile/lib/features/lottery/domain/usecases/get_lottery_results.dart
- [ ] T164 [P] [US3] Create GetUserCampaigns use case in mobile/lib/features/lottery/domain/usecases/get_user_campaigns.dart
- [ ] T165 [US3] Create Lottery BLoC in mobile/lib/features/lottery/presentation/bloc/lottery_bloc.dart
- [ ] T166 [US3] Create my campaigns screen in mobile/lib/features/lottery/presentation/pages/my_campaigns_page.dart
- [ ] T167 [US3] Create lottery results screen with triangle visualization in mobile/lib/features/lottery/presentation/pages/lottery_results_page.dart
- [ ] T168 [US3] Create winner detail screen in mobile/lib/features/lottery/presentation/pages/winner_detail_page.dart
- [ ] T169 [US3] Create progress indicator widget in mobile/lib/features/lottery/presentation/widgets/campaign_progress_widget.dart
- [ ] T170 [US3] Add FCM notification listener in main.dart
- [ ] T171 [US3] Add deep link handling for notification taps in fcm_handler.dart
- [ ] T172 [US3] Create notification permission request dialog in mobile/lib/features/lottery/presentation/widgets/notification_permission_dialog.dart

**Checkpoint**: User Story 3 complete - Progress tracking and lottery results fully functional

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Finalize non-functional requirements, performance optimization, and deployment readiness

### Authentication & User Management

- [ ] T173 [P] Implement user registration endpoint in api/src/routes/auth.routes.ts for POST /api/v1/auth/register
- [ ] T174 [P] Implement user login endpoint in api/src/routes/auth.routes.ts for POST /api/v1/auth/login
- [ ] T175 [P] Implement get user profile endpoint in api/src/routes/user.routes.ts for GET /api/v1/users/me
- [ ] T176 [P] Implement update user profile endpoint in api/src/routes/user.routes.ts for PUT /api/v1/users/me
- [ ] T177 [P] Create Auth feature in Flutter with mobile/lib/features/auth/
- [ ] T178 [P] Create login screen in mobile/lib/features/auth/presentation/pages/login_page.dart
- [ ] T179 [P] Create registration screen in mobile/lib/features/auth/presentation/pages/register_page.dart
- [ ] T180 [P] Create user profile screen in mobile/lib/features/auth/presentation/pages/profile_page.dart

### Admin Dashboard

- [ ] T181 [P] Create admin routes in api/src/routes/admin.routes.ts for GET /api/v1/admin/campaigns
- [ ] T182 [P] Add admin users listing endpoint in admin.routes.ts for GET /api/v1/admin/users
- [ ] T183 [P] Create admin dashboard screen in mobile/lib/features/admin/presentation/pages/admin_dashboard_page.dart
- [ ] T184 [P] Create admin campaigns management screen in mobile/lib/features/admin/presentation/pages/admin_campaigns_page.dart
- [ ] T185 [P] Create manual lottery draw trigger in admin dashboard

### Performance & Optimization

- [ ] T186 [P] Add database query optimization with proper indexes (already defined in migrations)
- [ ] T187 [P] Add Redis caching for campaign list in campaign.service.ts
- [ ] T188 [P] Add Redis caching for user purchase history in purchase.service.ts
- [ ] T189 [P] Implement connection pooling configuration in database.config.ts
- [ ] T190 [P] Add query performance monitoring in logger.util.ts
- [ ] T191 [P] Optimize Flutter image loading with cached_network_image in campaign widgets
- [ ] T192 [P] Add pagination for campaign list API and mobile screens

### Security & Compliance

- [ ] T193 [P] Implement audit logging for critical operations in api/src/services/audit.service.ts
- [ ] T194 [P] Add admin operation logging in admin controller
- [ ] T195 [P] Implement data encryption at rest configuration in database.config.ts
- [ ] T196 [P] Add HTTPS/TLS enforcement in api/src/app.ts
- [ ] T197 [P] Implement GDPR compliance endpoints (data export, deletion) in user.routes.ts
- [ ] T198 [P] Add security headers with Helmet middleware in app.ts

### Monitoring & Observability

- [ ] T199 [P] Add Prometheus metrics endpoints in api/src/routes/metrics.routes.ts
- [ ] T200 [P] Add health check endpoint in api/src/routes/health.routes.ts for GET /health
- [ ] T201 [P] Implement structured logging with Winston in logger.util.ts
- [ ] T202 [P] Add error tracking integration (e.g., Sentry) in error-handler.middleware.ts
- [ ] T203 [P] Add performance monitoring for critical paths in purchase and payment services
- [ ] T204 [P] Create monitoring dashboard configuration in infra/monitoring/

### Deployment & DevOps

- [ ] T205 [P] Create Dockerfile for API in api/Dockerfile
- [ ] T206 [P] Create docker-compose.yml for local development in infra/docker-compose.yml
- [ ] T207 [P] Create Kubernetes deployment manifests in infra/k8s/
- [ ] T208 [P] Create CI/CD pipeline configuration in .github/workflows/ci.yml
- [ ] T209 [P] Create database backup scripts in infra/scripts/backup.sh
- [ ] T210 [P] Create deployment documentation in infra/README.md
- [ ] T211 [P] Configure iOS app signing and provisioning profiles for mobile/ios/
- [ ] T212 [P] Configure Android app signing for mobile/android/
- [ ] T213 [P] Create App Store submission assets (screenshots, descriptions) in mobile/assets/store/
- [ ] T214 [P] Create Play Store submission assets in mobile/assets/store/

### Testing & Quality Assurance

- [ ] T215 [P] Create Jest configuration in api/jest.config.js
- [ ] T216 [P] Add unit tests for critical services (purchase, payment, lottery) in api/tests/unit/
- [ ] T217 [P] Add integration tests for purchase flow in api/tests/integration/purchase-flow.test.ts
- [ ] T218 [P] Add integration tests for lottery flow in api/tests/integration/lottery-flow.test.ts
- [ ] T219 [P] Add contract tests for Stripe API in api/tests/contract/stripe-api.test.ts
- [ ] T220 [P] Add contract tests for Stripe webhooks in api/tests/contract/stripe-webhook.test.ts
- [ ] T221 [P] Create Flutter test configuration in mobile/test/
- [ ] T222 [P] Add widget tests for critical screens in mobile/test/widget/
- [ ] T223 [P] Add integration tests for purchase flow in mobile/integration_test/purchase_flow_test.dart
- [ ] T224 [P] Create load testing scripts with k6 in api/tests/load/

### Documentation

- [ ] T225 [P] Update API documentation in contracts/api-openapi.yaml with actual implementations
- [ ] T226 [P] Create API usage examples in api/docs/examples/
- [ ] T227 [P] Update quickstart.md with final setup instructions
- [ ] T228 [P] Create troubleshooting guide in docs/TROUBLESHOOTING.md
- [ ] T229 [P] Create deployment guide in docs/DEPLOYMENT.md
- [ ] T230 [P] Update README.md with complete project documentation

**Checkpoint**: Application is production-ready with all polish tasks complete

---

## Dependencies & Implementation Strategy

### User Story Dependencies

```
Phase 2 (Foundational) → MUST complete first
  ↓
Phase 3 (US1: Campaigns) → Can run independently after Phase 2
  ↓
Phase 4 (US2: Purchase) → Depends on US1 (needs campaigns)
  ↓
Phase 5 (US4: Concurrency) → Extends US2 (mostly already implemented in US2)
  ↓
Phase 6 (US5: Payments) → Depends on US2 (needs purchases)
  ↓
Phase 7 (US3: Results) → Depends on US2, US5 (needs completed purchases/payments)
  ↓
Phase 8 (Polish) → Can run in parallel once core stories are done
```

### Parallel Execution Opportunities

**Phase 1 (Setup)**: Tasks T004-T009 can run in parallel after T001-T003

**Phase 2 (Foundational)**:
- T011-T012 (Database/Redis config) can run in parallel
- T015-T017 (Auth middleware) can run in parallel
- T020-T025 (API infrastructure) can run in parallel
- T028-T031 (External integrations) can run in parallel
- T032-T039 (Mobile infrastructure) can run in parallel

**Phase 3 (US1)**:
- T040-T043 (Entity models) can run in parallel
- T057-T060 (Mobile domain/data models) can run in parallel
- T064-T066 (Use cases) can run in parallel
- After API is complete: Mobile implementation can run in parallel

**Phase 4 (US2)**:
- T085-T087 (Mobile models) can run in parallel after T073-T074 (API entities) are done
- T091-T092 (Use cases) can run in parallel

**Phase 6 (US5)**:
- T109-T112 (Payment methods) can run in parallel
- T125-T127 (Mobile models) can run in parallel
- T130-T131 (Use cases) can run in parallel

**Phase 7 (US3)**:
- T156-T160 (Mobile models) can run in parallel
- T163-T164 (Use cases) can run in parallel

**Phase 8 (Polish)**: Almost all tasks can run in parallel by different team members

### MVP Scope (Minimum Viable Product)

**MVP = Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6**

This includes:
- US1 (P1): Campaign creation and management
- US2 (P1): Position purchase
- US4 (P1): Concurrent purchase control (integrated with US2)
- US5 (P1): Japanese payment methods

**Post-MVP**:
- US3 (P2): Progress tracking and lottery results
- Phase 8: Polish & Cross-cutting concerns

### Incremental Delivery Strategy

1. **Sprint 1-2**: Phase 1 + Phase 2 (Foundation)
2. **Sprint 3-4**: Phase 3 (US1 - Campaigns)
3. **Sprint 5-6**: Phase 4 + Phase 5 (US2 + US4 - Purchase & Concurrency)
4. **Sprint 7-8**: Phase 6 (US5 - Payments) → **MVP RELEASE**
5. **Sprint 9-10**: Phase 7 (US3 - Results & Lottery)
6. **Sprint 11-12**: Phase 8 (Polish & Production Hardening)

---

## Task Summary

**Total Tasks**: 230

**Tasks by Phase**:
- Phase 1 (Setup): 9 tasks
- Phase 2 (Foundational): 30 tasks
- Phase 3 (US1 - Campaigns): 33 tasks
- Phase 4 (US2 - Purchase): 25 tasks
- Phase 5 (US4 - Concurrency): 9 tasks
- Phase 6 (US5 - Payments): 32 tasks
- Phase 7 (US3 - Results): 34 tasks
- Phase 8 (Polish): 58 tasks

**Tasks by User Story**:
- US1: 33 tasks
- US2: 25 tasks
- US3: 34 tasks
- US4: 9 tasks
- US5: 32 tasks
- Infrastructure: 97 tasks

**Parallel Execution Potential**: ~60% of tasks can run in parallel within their phase

**MVP Task Count**: 138 tasks (Phases 1-6)

**Format Validation**: ✅ All tasks follow the required checklist format with ID, labels, and file paths

---

## Next Steps

1. Review and prioritize tasks with the team
2. Assign tasks to developers based on expertise (API vs Mobile)
3. Set up project tracking (e.g., GitHub Projects, Jira)
4. Begin with Phase 1 (Setup) to establish the project foundation
5. Complete Phase 2 (Foundational) before starting any user story work
6. Implement user stories in priority order (US1 → US2+US4 → US5 → MVP Release → US3)
7. Run continuous integration and testing throughout development
8. Plan for production deployment after Phase 8 completion

---

**Generated by**: `/speckit.tasks` | **Date**: 2025-11-11
