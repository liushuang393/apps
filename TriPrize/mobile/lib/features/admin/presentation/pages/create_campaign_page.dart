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

  // Layer prices
  final Map<String, TextEditingController> _layerPriceControllers = {
    '1': TextEditingController(text: '1000'),
    '2': TextEditingController(text: '2000'),
    '3': TextEditingController(text: '3000'),
  };

  // Prizes
  final List<PrizeFormData> _prizes = [];

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _baseLengthController.dispose();
    _profitMarginController.dispose();
    _purchaseLimitController.dispose();
    for (var controller in _layerPriceControllers.values) {
      controller.dispose();
    }
    for (var prize in _prizes) {
      prize.dispose();
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
            _buildSectionTitle('レイヤー価格設定'),
            const SizedBox(height: 12),
            ..._buildLayerPriceFields(),
            const SizedBox(height: 24),

            // Prizes Section
            _buildSectionTitle('賞品設定'),
            const SizedBox(height: 12),
            if (_prizes.isEmpty)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Icon(Icons.card_giftcard,
                          size: 48, color: AppTheme.textSecondaryColor),
                      SizedBox(height: 8),
                      Text(
                        '賞品が登録されていません',
                        style: AppTheme.body2,
                      ),
                      SizedBox(height: 8),
                      Text(
                        '最低1つの賞品を追加してください',
                        style: AppTheme.caption,
                      ),
                    ],
                  ),
                ),
              )
            else
              ..._prizes
                  .asMap()
                  .entries
                  .map((entry) => _buildPrizeCard(entry.key)),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _addPrize,
              icon: const Icon(Icons.add),
              label: const Text('賞品を追加'),
            ),
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
    return _layerPriceControllers.entries.map((entry) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextFormField(
          controller: entry.value,
          decoration: InputDecoration(
            labelText: 'レイヤー${entry.key}の価格 *',
            prefixText: '¥',
          ),
          keyboardType: TextInputType.number,
          validator: (value) {
            if (value == null || value.isEmpty) {
              return '価格は必須です';
            }
            final n = int.tryParse(value);
            if (n == null || n < 100) {
              return '100円以上を入力してください';
            }
            return null;
          },
        ),
      );
    }).toList();
  }

  Widget _buildPrizeCard(int index) {
    final prize = _prizes[index];
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('賞品 ${index + 1}', style: AppTheme.heading3),
                IconButton(
                  icon: const Icon(Icons.delete, color: AppTheme.errorColor),
                  onPressed: () => _removePrize(index),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: prize.nameController,
              decoration: const InputDecoration(
                labelText: '賞品名 *',
                hintText: '例: 豪華賞品A',
              ),
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return '賞品名は必須です';
                }
                return null;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: prize.descriptionController,
              decoration: const InputDecoration(
                labelText: '説明',
              ),
              maxLines: 2,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: prize.rankController,
                    decoration: const InputDecoration(
                      labelText: 'ランク *',
                      hintText: '1, 2, 3...',
                    ),
                    keyboardType: TextInputType.number,
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return 'ランクは必須';
                      }
                      final n = int.tryParse(value);
                      if (n == null || n < 1) {
                        return '1以上';
                      }
                      return null;
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: prize.quantityController,
                    decoration: const InputDecoration(
                      labelText: '数量 *',
                      hintText: '1, 2, 3...',
                    ),
                    keyboardType: TextInputType.number,
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return '数量は必須';
                      }
                      final n = int.tryParse(value);
                      if (n == null || n < 1) {
                        return '1以上';
                      }
                      return null;
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: prize.valueController,
                    decoration: const InputDecoration(
                      labelText: '価値 *',
                      prefixText: '¥',
                    ),
                    keyboardType: TextInputType.number,
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return '価値は必須';
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
  }

  void _addPrize() {
    setState(() {
      _prizes.add(PrizeFormData());
    });
  }

  void _removePrize(int index) {
    setState(() {
      _prizes[index].dispose();
      _prizes.removeAt(index);
    });
  }

  Future<void> _submitForm() async {
    if (!_formKey.currentState!.validate()) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('入力内容を確認してください'),
          backgroundColor: AppTheme.errorColor,
        ),
      );
      return;
    }

    if (_prizes.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('最低1つの賞品を追加してください'),
          backgroundColor: AppTheme.errorColor,
        ),
      );
      return;
    }

    // Build DTO
    final dto = CreateCampaignDto(
      name: _nameController.text,
      description: _descriptionController.text.isEmpty
          ? null
          : _descriptionController.text,
      baseLength: int.parse(_baseLengthController.text),
      layerPrices: _layerPriceControllers
          .map((key, controller) => MapEntry(key, int.parse(controller.text))),
      profitMarginPercent: double.parse(_profitMarginController.text),
      purchaseLimit: _purchaseLimitController.text.isEmpty
          ? null
          : int.parse(_purchaseLimitController.text),
      prizes: _prizes
          .map((p) => CreatePrizeDto(
                name: p.nameController.text,
                description: p.descriptionController.text.isEmpty
                    ? null
                    : p.descriptionController.text,
                rank: int.parse(p.rankController.text),
                quantity: int.parse(p.quantityController.text),
                value: int.parse(p.valueController.text),
              ))
          .toList(),
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

/// Prize form data helper class
class PrizeFormData {
  final nameController = TextEditingController();
  final descriptionController = TextEditingController();
  final rankController = TextEditingController(text: '1');
  final quantityController = TextEditingController(text: '1');
  final valueController = TextEditingController(text: '10000');

  void dispose() {
    nameController.dispose();
    descriptionController.dispose();
    rankController.dispose();
    quantityController.dispose();
    valueController.dispose();
  }
}
