import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../../../campaign/presentation/providers/campaign_provider.dart';
import '../../../admin/data/models/create_campaign_dto.dart';

/// Create campaign page for admin
class CreateCampaignPage extends StatefulWidget {
  const CreateCampaignPage({super.key});

  @override
  State<CreateCampaignPage> createState() => _CreateCampaignPageState();
}

class _CreateCampaignPageState extends State<CreateCampaignPage> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _baseLengthController = TextEditingController(text: '3');
  final _profitMarginController = TextEditingController(text: '10.0');
  final _purchaseLimitController = TextEditingController();

  // 手動設定の抽選価格（円）- 空の場合は自動計算を使用
  final _manualTicketPriceController = TextEditingController();
  // 手動価格を使用するかどうかのフラグ
  bool _useManualPrice = false;

  // Layer prices (1等奖最大、等级越低金额越小)
  Map<String, TextEditingController> _layerPriceControllers = {
    '1': TextEditingController(text: '10000'),
    '2': TextEditingController(text: '5000'),
    '3': TextEditingController(text: '1000'),
  };

  // Layer names (各層の賞品名)
  Map<String, TextEditingController> _layerNameControllers = {
    '1': TextEditingController(text: '1等賞'),
    '2': TextEditingController(text: '2等賞'),
    '3': TextEditingController(text: '3等賞'),
  };

  @override
  void initState() {
    super.initState();
    // リアルタイム計算のためのリスナー
    _baseLengthController.addListener(_onBaseLengthChanged);
    _profitMarginController.addListener(_refreshUI);
    _addLayerPriceListeners();
  }

  void _onBaseLengthChanged() {
    final newLength = int.tryParse(_baseLengthController.text) ?? 3;
    if (newLength < 1 || newLength > 10) return;

    // 必要に応じて _layerPriceControllers と _layerNameControllers を更新
    final currentKeys = _layerPriceControllers.keys.map(int.parse).toList();
    final needsUpdate = currentKeys.length != newLength;

    if (needsUpdate) {
      // 古いリスナーを削除
      for (final controller in _layerPriceControllers.values) {
        controller.removeListener(_refreshUI);
      }

      // 価格コントローラーを作成
      final newPriceControllers = <String, TextEditingController>{};
      final newNameControllers = <String, TextEditingController>{};
      for (int i = 1; i <= newLength; i++) {
        final key = i.toString();
        // 価格コントローラー
        if (_layerPriceControllers.containsKey(key)) {
          newPriceControllers[key] = _layerPriceControllers[key]!;
        } else {
          final defaultValue = (1000 ~/ i).clamp(100, 1000) * 10;
          newPriceControllers[key] = TextEditingController(text: '$defaultValue');
        }
        // 名称コントローラー
        if (_layerNameControllers.containsKey(key)) {
          newNameControllers[key] = _layerNameControllers[key]!;
        } else {
          newNameControllers[key] = TextEditingController(text: '$i等賞');
        }
      }

      // 不要なコントローラーをdispose
      for (final entry in _layerPriceControllers.entries) {
        if (!newPriceControllers.containsKey(entry.key)) {
          entry.value.dispose();
        }
      }
      for (final entry in _layerNameControllers.entries) {
        if (!newNameControllers.containsKey(entry.key)) {
          entry.value.dispose();
        }
      }

      _layerPriceControllers = newPriceControllers;
      _layerNameControllers = newNameControllers;
      _addLayerPriceListeners();
    }

    _refreshUI();
  }

  void _addLayerPriceListeners() {
    for (final controller in _layerPriceControllers.values) {
      controller.addListener(_refreshUI);
    }
  }

  void _refreshUI() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    // リスナーを削除
    _baseLengthController.removeListener(_onBaseLengthChanged);
    _profitMarginController.removeListener(_refreshUI);
    for (final controller in _layerPriceControllers.values) {
      controller.removeListener(_refreshUI);
    }
    // コントローラーをdispose
    _nameController.dispose();
    _descriptionController.dispose();
    _baseLengthController.dispose();
    _profitMarginController.dispose();
    _purchaseLimitController.dispose();
    _manualTicketPriceController.dispose();
    for (var controller in _layerPriceControllers.values) {
      controller.dispose();
    }
    for (var controller in _layerNameControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('新規キャンペーン作成'),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Basic Info Section
            _buildSectionTitle('基本情報'),
            const SizedBox(height: 12),
            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'キャンペーン名 *',
                hintText: '例: 2025年新春くじ',
              ),
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return 'キャンペーン名は必須です';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _descriptionController,
              decoration: const InputDecoration(
                labelText: '説明',
                hintText: 'キャンペーンの詳細を入力',
              ),
              maxLines: 3,
            ),
            const SizedBox(height: 24),

            // Triangle Configuration
            _buildSectionTitle('三角形設定'),
            const SizedBox(height: 12),
            TextFormField(
              controller: _baseLengthController,
              decoration: const InputDecoration(
                labelText: '基礎長 *',
                hintText: '3〜50',
                suffixText: '辺',
              ),
              keyboardType: TextInputType.number,
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return '基礎長は必須です';
                }
                final n = int.tryParse(value);
                if (n == null || n < 3 || n > 50) {
                  return '3〜50の範囲で入力してください';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _profitMarginController,
              decoration: const InputDecoration(
                labelText: '利益率 *',
                hintText: '0〜100',
                suffixText: '%',
              ),
              keyboardType: TextInputType.number,
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return '利益率は必須です';
                }
                final n = double.tryParse(value);
                if (n == null || n < 0 || n > 100) {
                  return '0〜100の範囲で入力してください';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _purchaseLimitController,
              decoration: const InputDecoration(
                labelText: '購入制限',
                hintText: '制限なしの場合は空欄',
                suffixText: '回/ユーザー',
              ),
              keyboardType: TextInputType.number,
              validator: (value) {
                if (value != null && value.isNotEmpty) {
                  final n = int.tryParse(value);
                  if (n == null || n < 1) {
                    return '1以上の数値を入力してください';
                  }
                }
                return null;
              },
            ),
            const SizedBox(height: 24),

            // Layer Prices Section
            _buildSectionTitle('レイヤー賞品価値'),
            const SizedBox(height: 4),
            const Text(
              '各レイヤーの当選賞品の価値（原価）を設定します。\n'
              '例: レイヤー1=1等賞（1名）、レイヤー2=2等賞（3名中1名当選）',
              style: AppTheme.caption,
            ),
            const SizedBox(height: 12),
            ..._buildLayerPriceFields(),
            const SizedBox(height: 16),
            _buildPriceCalculationPreview(),
            const SizedBox(height: 32),

            // Submit Button
            ElevatedButton(
              onPressed: _submitForm,
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.all(16),
              ),
              child: const Text('キャンペーンを作成'),
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Text(
      title,
      style: AppTheme.heading3,
    );
  }

  List<Widget> _buildLayerPriceFields() {
    final entries = _layerPriceControllers.entries.toList();
    // 層N の格子数 = N (1, 2, 3, 4...)
    // 層1=1格子（1等賞）、層2=2格子、層3=3格子...
    int getPositionCount(int layer) => layer;

    return entries.map((entry) {
      final layerNum = int.parse(entry.key);
      final posCount = getPositionCount(layerNum);
      final winRate = (100 / posCount).toStringAsFixed(1);
      final nameController = _layerNameControllers[entry.key];
      return Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'レイヤー$layerNum（$posCount名・当選率$winRate%）',
                style: AppTheme.body2.copyWith(fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  // 賞品名入力
                  Expanded(
                    flex: 2,
                    child: TextFormField(
                      controller: nameController,
                      decoration: InputDecoration(
                        labelText: '賞品名 *',
                        hintText: '$layerNum等賞',
                        isDense: true,
                      ),
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return '賞品名は必須です';
                        }
                        return null;
                      },
                    ),
                  ),
                  const SizedBox(width: 12),
                  // 価値入力
                  Expanded(
                    flex: 1,
                    child: TextFormField(
                      controller: entry.value,
                      decoration: const InputDecoration(
                        labelText: '価値 *',
                        prefixText: '¥',
                        isDense: true,
                      ),
                      keyboardType: TextInputType.number,
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return '必須';
                        }
                        final n = int.tryParse(value);
                        if (n == null || n < 0) {
                          return '0以上';
                        }
                        return null;
                      },
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
    }).toList();
  }

  /// 抽選価格計算プレビュー
  /// 目的: 管理者に計算結果をリアルタイムで表示し、手動価格設定を可能にする
  /// 注意点: 手動価格が設定されている場合は自動計算値より優先される
  Widget _buildPriceCalculationPreview() {
    // 総奖品成本を計算: Σ (layer_prices[N] × N)
    // 層Nには N人いるので、各層の奖品価値 × 人数
    int totalPrizeCost = 0;
    for (final entry in _layerPriceControllers.entries) {
      final layerNum = int.parse(entry.key);
      final prizeValuePerPerson = int.tryParse(entry.value.text) ?? 0;
      totalPrizeCost += prizeValuePerPerson * layerNum;
    }

    // base_length と 利润率を取得
    final baseLength = int.tryParse(_baseLengthController.text) ?? 3;
    final profitMargin = double.tryParse(_profitMarginController.text) ?? 10.0;

    // 総格子数を計算 (1 + 2 + 3 + ... + N = N(N+1)/2)
    // 層1=1格子、層2=2格子...層N=N格子
    final totalPositions = (baseLength * (baseLength + 1)) ~/ 2;

    // 奖池金额 = 総成本 / (1 - 利润率/100)
    double prizePool = 0;
    if (profitMargin < 100 && totalPrizeCost > 0) {
      prizePool = totalPrizeCost / (1 - profitMargin / 100);
    }

    // 抽選単価 = 奖池金额 / 総格子数（自動計算値）
    final autoTicketPrice = totalPositions > 0 ? (prizePool / totalPositions).ceil() : 0;

    // 手動価格または自動計算値を使用
    final manualPrice = int.tryParse(_manualTicketPriceController.text);
    final effectivePrice = (_useManualPrice && manualPrice != null && manualPrice >= 100)
        ? manualPrice
        : autoTicketPrice;

    return Card(
      color: AppTheme.primaryColor.withAlpha((0.1 * 255).toInt()),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.calculate, color: AppTheme.primaryColor),
                SizedBox(width: 8),
                Text('価格計算プレビュー', style: AppTheme.heading3),
              ],
            ),
            const SizedBox(height: 12),
            _buildPreviewRow('総奖品成本', '¥$totalPrizeCost'),
            _buildPreviewRow('利益率', '$profitMargin%'),
            _buildPreviewRow('総格子数', '$totalPositions マス'),
            _buildPreviewRow('奖池金額', '¥${prizePool.toStringAsFixed(0)}'),
            const Divider(),
            _buildPreviewRow(
              '自動計算単価（参考値）',
              '¥$autoTicketPrice',
              highlight: !_useManualPrice,
            ),
            const SizedBox(height: 12),
            // 手動価格設定セクション
            Row(
              children: [
                Checkbox(
                  value: _useManualPrice,
                  onChanged: (value) {
                    setState(() {
                      _useManualPrice = value ?? false;
                    });
                  },
                ),
                const Text('手動で価格を設定', style: AppTheme.body2),
              ],
            ),
            if (_useManualPrice) ...[
              const SizedBox(height: 8),
              TextFormField(
                controller: _manualTicketPriceController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: '抽選単価（円）',
                  hintText: '100以上の整数',
                  prefixText: '¥',
                  border: OutlineInputBorder(),
                ),
                onChanged: (_) => _refreshUI(),
                validator: (value) {
                  if (_useManualPrice) {
                    if (value == null || value.isEmpty) {
                      return '手動価格を入力してください';
                    }
                    final price = int.tryParse(value);
                    if (price == null || price < 100) {
                      return '100円以上で設定してください';
                    }
                  }
                  return null;
                },
              ),
            ],
            const SizedBox(height: 8),
            _buildPreviewRow(
              '適用される抽選単価',
              '¥$effectivePrice',
              highlight: true,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPreviewRow(String label, String value, {bool highlight = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: AppTheme.body2),
          Text(
            value,
            style: highlight
                ? AppTheme.heading3.copyWith(color: AppTheme.primaryColor)
                : AppTheme.body1,
          ),
        ],
      ),
    );
  }

  Future<void> _submitForm() async {
    // フォームバリデーション
    if (!_formKey.currentState!.validate()) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('入力内容を確認してください'),
          backgroundColor: AppTheme.errorColor,
        ),
      );
      return;
    }

    // 必須フィールドの二重チェック（バリデーション通過後の安全対策）
    final name = _nameController.text.trim();
    final baseLength = int.tryParse(_baseLengthController.text);
    final profitMargin = double.tryParse(_profitMarginController.text);

    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('キャンペーン名を入力してください'),
          backgroundColor: AppTheme.errorColor,
        ),
      );
      return;
    }

    if (baseLength == null || baseLength < 3 || baseLength > 50) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('基礎長は3〜50の範囲で入力してください'),
          backgroundColor: AppTheme.errorColor,
        ),
      );
      return;
    }

    if (profitMargin == null || profitMargin < 0 || profitMargin > 100) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('利益率は0〜100の範囲で入力してください'),
          backgroundColor: AppTheme.errorColor,
        ),
      );
      return;
    }

    // 賞品は任意（後から追加可能）

    // 手動価格を取得（使用フラグがオンで有効な値の場合のみ）
    int? manualPrice;
    if (_useManualPrice) {
      final priceValue = int.tryParse(_manualTicketPriceController.text);
      if (priceValue != null && priceValue >= 100) {
        manualPrice = priceValue;
      }
    }

    // Build DTO
    final dto = CreateCampaignDto(
      name: name,
      description: _descriptionController.text.isEmpty
          ? null
          : _descriptionController.text,
      baseLength: int.parse(_baseLengthController.text),
      layerPrices: _layerPriceControllers
          .map((key, controller) => MapEntry(key, int.parse(controller.text))),
      layerNames: _layerNameControllers
          .map((key, controller) => MapEntry(key, controller.text.trim())),
      profitMarginPercent: double.parse(_profitMarginController.text),
      purchaseLimit: _purchaseLimitController.text.isEmpty
          ? null
          : int.parse(_purchaseLimitController.text),
      manualTicketPrice: manualPrice, // 手動設定の抽選価格（円）
      // 賞品は層設定から自動生成されるため、空リストを送信
      prizes: [],
    );

    // Submit
    try {
      final provider = context.read<CampaignProvider>();
      await provider.createCampaign(dto);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('キャンペーンを作成しました'),
            backgroundColor: AppTheme.successColor,
          ),
        );
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('作成に失敗しました: $e'),
            backgroundColor: AppTheme.errorColor,
          ),
        );
      }
    }
  }
}
