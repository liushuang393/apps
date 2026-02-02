import 'package:flutter/material.dart';
import '../../../../core/constants/app_theme.dart';

/// 利用規約画面
/// 目的: アプリの利用規約を表示
/// 注意点: 実際の利用規約内容は法律専門家に確認が必要
class TermsOfServicePage extends StatelessWidget {
  const TermsOfServicePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('利用規約'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '利用規約',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              '最終更新日: 2025年1月1日',
              style: TextStyle(
                fontSize: 14,
                color: AppTheme.textSecondaryColor,
              ),
            ),
            const SizedBox(height: 24),
            _buildSection(
              '第1条（適用）',
              '本規約は、TriPrize（以下「当社」といいます）が提供するサービス（以下「本サービス」といいます）の利用条件を定めるものです。',
            ),
            _buildSection(
              '第2条（利用登録）',
              '本サービスの利用を希望する者は、当社の定める方法により利用登録を申請し、当社がこれを承認することによって、利用登録が完了するものとします。',
            ),
            _buildSection(
              '第3条（利用料金）',
              '本サービスの利用料金は、各キャンペーンの購入時に表示される金額とします。',
            ),
            _buildSection(
              '第4条（禁止事項）',
              '利用者は、本サービスの利用にあたり、以下の行為をしてはなりません。\n'
              '1. 法令または公序良俗に違反する行為\n'
              '2. 犯罪行為に関連する行為\n'
              '3. 本サービスの内容等、本サービスに含まれる著作権、商標権ほか知的財産権を侵害する行為\n'
              '4. 当社、ほかの利用者、またはその他第三者のサーバーまたはネットワークの機能を破壊したり、妨害したりする行為\n'
              '5. 本サービスによって得られた情報を商業的に利用する行為\n'
              '6. 当社のサービスの運営を妨害するおそれのある行為\n'
              '7. 不正アクセス、なりすまし、その他不正な手段により本サービスを利用する行為\n'
              '8. その他、当社が不適切と判断する行為',
            ),
            _buildSection(
              '第5条（本サービスの提供の停止等）',
              '当社は、以下のいずれかの事由があると判断した場合、利用者に事前に通知することなく本サービスの全部または一部の提供を停止または中断することができるものとします。',
            ),
            _buildSection(
              '第6条（保証の否認および免責）',
              '当社は、本サービスに事実上または法律上の瑕疵（安全性、信頼性、正確性、完全性、有効性、特定の目的への適合性、セキュリティなどに関する欠陥、エラーやバグ、権利侵害などを含みます）がないことを明示的にも黙示的にも保証しておりません。',
            ),
            _buildSection(
              '第7条（サービス内容の変更等）',
              '当社は、利用者に通知することなく、本サービスの内容を変更しまたは本サービスの提供を中止することができるものとし、これによって利用者に生じた損害について一切の責任を負いません。',
            ),
            _buildSection(
              '第8条（利用規約の変更）',
              '当社は、必要と判断した場合には、利用者に通知することなくいつでも本規約を変更することができるものとします。',
            ),
            _buildSection(
              '第9条（個人情報の取扱い）',
              '当社は、本サービスの利用によって取得する個人情報については、当社「プライバシーポリシー」に従い適切に取り扱うものとします。',
            ),
            _buildSection(
              '第10条（準拠法・裁判管轄）',
              '本規約の解釈にあたっては、日本法を準拠法とします。本サービスに関して紛争が生じた場合には、当社の本店所在地を管轄する裁判所を専属的合意管轄とします。',
            ),
            const SizedBox(height: 32),
            const Text(
              '※本規約は、実際のサービス提供に合わせて法律専門家に確認の上、適切に更新してください。',
              style: TextStyle(
                fontSize: 12,
                color: AppTheme.textSecondaryColor,
                fontStyle: FontStyle.italic,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSection(String title, String content) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            content,
            style: const TextStyle(
              fontSize: 14,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }
}
