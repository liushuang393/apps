import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../../core/constants/app_theme.dart';
import '../providers/user_provider.dart';
import '../../data/models/user_model.dart';

/// 配送先住所編集ページ
/// 目的: ユーザーが配送先住所を登録・編集する
/// I/O: UserProviderを使用して住所を更新
/// 注意点: 郵便番号、都道府県、市区町村、番地は必須
class AddressEditPage extends StatefulWidget {
  /// 既存の住所（編集時）
  final ShippingAddress? currentAddress;

  const AddressEditPage({super.key, this.currentAddress});

  @override
  State<AddressEditPage> createState() => _AddressEditPageState();
}

class _AddressEditPageState extends State<AddressEditPage> {
  final _formKey = GlobalKey<FormState>();
  final _postalCodeController = TextEditingController();
  final _prefectureController = TextEditingController();
  final _cityController = TextEditingController();
  final _addressLine1Controller = TextEditingController();
  final _addressLine2Controller = TextEditingController();
  bool _isLoading = false;

  /// 都道府県リスト
  static const List<String> _prefectures = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
    '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
    '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
    '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
    '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
  ];

  @override
  void initState() {
    super.initState();
    // 既存の住所がある場合は初期値を設定
    if (widget.currentAddress != null) {
      _postalCodeController.text = widget.currentAddress!.postalCode ?? '';
      _prefectureController.text = widget.currentAddress!.prefecture ?? '';
      _cityController.text = widget.currentAddress!.city ?? '';
      _addressLine1Controller.text = widget.currentAddress!.addressLine1 ?? '';
      _addressLine2Controller.text = widget.currentAddress!.addressLine2 ?? '';
    }
  }

  @override
  void dispose() {
    _postalCodeController.dispose();
    _prefectureController.dispose();
    _cityController.dispose();
    _addressLine1Controller.dispose();
    _addressLine2Controller.dispose();
    super.dispose();
  }

  /// 住所を保存
  Future<void> _saveAddress() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isLoading = true;
    });

    try {
      final provider = context.read<UserProvider>();
      await provider.updateAddress(
        postalCode: _postalCodeController.text.trim(),
        prefecture: _prefectureController.text.trim(),
        city: _cityController.text.trim(),
        addressLine1: _addressLine1Controller.text.trim(),
        addressLine2: _addressLine2Controller.text.trim().isEmpty
            ? null
            : _addressLine2Controller.text.trim(),
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('配送先住所を保存しました'),
            backgroundColor: AppTheme.successColor,
          ),
        );
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      if (mounted) {
        // エラーメッセージを長時間表示
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('エラー: $e'),
            backgroundColor: AppTheme.errorColor,
            duration: const Duration(seconds: 10),
            action: SnackBarAction(
              label: '閉じる',
              textColor: Colors.white,
              onPressed: () {
                ScaffoldMessenger.of(context).hideCurrentSnackBar();
              },
            ),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('配送先住所'),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // 説明テキスト
            const Card(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Row(
                  children: [
                    Icon(Icons.info_outline, color: AppTheme.primaryColor),
                    SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        '当選した賞品をお届けするための住所を登録してください。',
                        style: TextStyle(fontSize: 14),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),

            // 郵便番号
            TextFormField(
              controller: _postalCodeController,
              decoration: const InputDecoration(
                labelText: '郵便番号 *',
                hintText: '123-4567',
                prefixIcon: Icon(Icons.local_post_office),
              ),
              keyboardType: TextInputType.number,
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return '郵便番号を入力してください';
                }
                // 郵便番号形式チェック
                final regex = RegExp(r'^\d{3}-?\d{4}$');
                if (!regex.hasMatch(value)) {
                  return '正しい形式で入力してください（例: 123-4567）';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),
            // 都道府県
            DropdownButtonFormField<String>(
              initialValue: _prefectures.contains(_prefectureController.text)
                  ? _prefectureController.text
                  : null,
              decoration: const InputDecoration(
                labelText: '都道府県 *',
                prefixIcon: Icon(Icons.location_city),
              ),
              items: _prefectures.map((pref) {
                return DropdownMenuItem(value: pref, child: Text(pref));
              }).toList(),
              onChanged: (value) {
                if (value != null) {
                  _prefectureController.text = value;
                }
              },
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return '都道府県を選択してください';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),

            // 市区町村
            TextFormField(
              controller: _cityController,
              decoration: const InputDecoration(
                labelText: '市区町村 *',
                hintText: '例: 渋谷区',
                prefixIcon: Icon(Icons.location_on),
              ),
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return '市区町村を入力してください';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),

            // 町名・番地
            TextFormField(
              controller: _addressLine1Controller,
              decoration: const InputDecoration(
                labelText: '町名・番地 *',
                hintText: '例: 道玄坂1-2-3',
                prefixIcon: Icon(Icons.home),
              ),
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return '町名・番地を入力してください';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),

            // 建物名・部屋番号（任意）
            TextFormField(
              controller: _addressLine2Controller,
              decoration: const InputDecoration(
                labelText: '建物名・部屋番号（任意）',
                hintText: '例: ○○マンション 101号室',
                prefixIcon: Icon(Icons.apartment),
              ),
            ),
            const SizedBox(height: 32),

            // 保存ボタン
            SizedBox(
              height: 50,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _saveAddress,
                child: _isLoading
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('保存する'),
              ),
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}

