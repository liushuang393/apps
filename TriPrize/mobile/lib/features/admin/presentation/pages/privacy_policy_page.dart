import 'package:flutter/material.dart';
import '../../../../core/constants/app_theme.dart';

/// プライバシーポリシー画面
/// 目的: アプリのプライバシーポリシーを表示
/// 注意点: 実際のプライバシーポリシー内容は法律専門家に確認が必要
class PrivacyPolicyPage extends StatelessWidget {
  const PrivacyPolicyPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('プライバシーポリシー'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'プライバシーポリシー',
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
              '1. 個人情報の取得',
              '当社は、本サービスの提供にあたり、以下の個人情報を取得いたします。\n'
              '・氏名\n'
              '・メールアドレス\n'
              '・電話番号\n'
              '・配送先住所\n'
              '・決済情報（クレジットカード情報等は直接保存せず、決済代行業者を通じて処理します）',
            ),
            _buildSection(
              '2. 個人情報の利用目的',
              '当社は、取得した個人情報を以下の目的で利用いたします。\n'
              '・本サービスの提供・運営のため\n'
              '・ユーザーからのお問い合わせに回答するため\n'
              '・ユーザーが利用中のサービスの新機能、更新情報、キャンペーン等の案内のため\n'
              '・メンテナンス、重要なお知らせなど必要に応じたご連絡のため\n'
              '・利用規約に違反したユーザーや、不正・不当な目的でサービスを利用しようとするユーザーの特定をし、ご利用をお断りするため\n'
              '・ユーザーにご自身の登録情報の閲覧・変更・削除・ご利用状況の閲覧を行っていただくため\n'
              '・上記の利用目的に付随する目的',
            ),
            _buildSection(
              '3. 個人情報の第三者提供',
              '当社は、次に掲げる場合を除いて、あらかじめユーザーの同意を得ることなく、第三者に個人情報を提供することはありません。\n'
              '・法令に基づく場合\n'
              '・人の生命、身体または財産の保護のために必要がある場合\n'
              '・公衆衛生の向上または児童の健全な育成の推進のために特に必要がある場合\n'
              '・国の機関もしくは地方公共団体またはその委託を受けた者が法令の定める事務を遂行することに対して協力する必要がある場合',
            ),
            _buildSection(
              '4. 個人情報の開示',
              '当社は、本人から個人情報の開示を求められたときは、本人に対し、遅滞なくこれを開示します。',
            ),
            _buildSection(
              '5. 個人情報の訂正および削除',
              'ユーザーは、当社の保有する自己の個人情報が誤った情報である場合には、当社が定める手続により、当社に対して個人情報の訂正、追加または削除を請求することができます。',
            ),
            _buildSection(
              '6. 個人情報の利用停止等',
              '当社は、本人から、個人情報が、利用目的の範囲を超えて取り扱われているという理由、または不正の手段により取得されたものであるという理由により、その利用の停止または消去（以下「利用停止等」といいます）を求められた場合には、遅滞なく必要な調査を行います。',
            ),
            _buildSection(
              '7. プライバシーポリシーの変更',
              '本ポリシーの内容は、法令その他本ポリシーに別段の定めのある事項を除いて、ユーザーに通知することなく、変更することができるものとします。',
            ),
            _buildSection(
              '8. お問い合わせ窓口',
              '本ポリシーに関するお問い合わせは、下記の窓口までお願いいたします。\n'
              'メールアドレス: support@triprize.example.com',
            ),
            const SizedBox(height: 32),
            const Text(
              '※本プライバシーポリシーは、実際のサービス提供に合わせて法律専門家に確認の上、適切に更新してください。',
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
