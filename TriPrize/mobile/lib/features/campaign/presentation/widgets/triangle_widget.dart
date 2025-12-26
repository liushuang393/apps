import 'package:flutter/material.dart';
import '../../../../core/constants/app_theme.dart';
import '../../data/models/campaign_model.dart';

/// 層ごとの色定義（賞品リストと完全一致）
/// 目的: 三角形と賞品リストで同じ色を使用
class LayerColors {
  static const List<Color> prizeColors = [
    Color(0xFFFFD700), // 1等: ゴールド
    Color(0xFFC0C0C0), // 2等: シルバー
    Color(0xFFCD7F32), // 3等: ブロンズ
    Color(0xFF4CAF50), // 4等: グリーン
    Color(0xFF2196F3), // 5等: ブルー
    Color(0xFF9C27B0), // 6等: パープル
    Color(0xFFE91E63), // 7等: ピンク
    Color(0xFF00BCD4), // 8等: シアン
    Color(0xFFFF9800), // 9等: オレンジ
    Color(0xFF795548), // 10等: ブラウン
  ];

  /// 層番号に応じた色を取得
  static Color getColor(int layerNumber) {
    if (layerNumber <= 0) return AppTheme.primaryColor;
    final index = (layerNumber - 1) % prizeColors.length;
    return prizeColors[index];
  }

  /// グラデーション用の色を取得
  static List<Color> getGradientColors(int layerNumber) {
    final baseColor = getColor(layerNumber);
    return [baseColor, baseColor.withValues(alpha: 0.7)];
  }
}

/// Triangle visualization widget
/// 目的: 三角形の層構造を視覚的に表示
/// I/O: 層データを受け取り、インタラクティブな三角形を描画
/// 注意点: 層の選択状態、販売進捗を色で表現
class TriangleWidget extends StatelessWidget {
  final int baseLength;
  final List<LayerModel> layers;
  final int? selectedLayerNumber;
  final Function(int layerNumber)? onLayerTap;

  const TriangleWidget({
    required this.baseLength, required this.layers, super.key,
    this.selectedLayerNumber,
    this.onLayerTap,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final maxWidth = constraints.maxWidth;
        // 三角形のサイズを1/4に縮小（幅・高さ両方）
        final triangleSize = maxWidth * 0.25;

        return Center(
          child: SizedBox(
            width: triangleSize,
            height: triangleSize,
            child: CustomPaint(
              painter: TrianglePainter(
                baseLength: baseLength,
                layers: layers,
                selectedLayerNumber: selectedLayerNumber,
              ),
              child: Stack(
                children: _buildLayerButtons(context, triangleSize, triangleSize),
              ),
            ),
          ),
        );
      },
    );
  }

  List<Widget> _buildLayerButtons(
    BuildContext context,
    double width,
    double height,
  ) {
    final buttons = <Widget>[];

    for (int i = 0; i < layers.length; i++) {
      final layer = layers[i];
      final layerNumber = layer.layerNumber;

      // 各層の位置を計算（上から下へ）
      final layerIndex = layerNumber - 1;
      final totalLayers = baseLength;

      // 層の高さ
      final layerHeight = height / totalLayers;
      // 層の幅（底辺に近いほど広い）
      final layerWidth = (width / totalLayers) * layerNumber;
      // 層の中心X座標
      final centerX = width / 2;
      // 層のY座標（上端からの距離）
      final topY = layerHeight * layerIndex;

      final isSoldOut = layer.positionsSold >= layer.positionsCount;
      final isSelected = selectedLayerNumber == layerNumber;

      buttons.add(
        Positioned(
          left: centerX - (layerWidth / 2),
          top: topY + (layerHeight * 0.2),
          width: layerWidth,
          height: layerHeight * 0.6,
          child: GestureDetector(
            onTap: isSoldOut || onLayerTap == null
                ? null
                : () => onLayerTap!(layerNumber),
            child: Container(
              decoration: BoxDecoration(
                color: Colors.transparent,
                border: isSelected
                    ? Border.all(
                        color: AppTheme.primaryColor,
                        width: 2,
                      )
                    : null,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Center(
                child: Text(
                  'L$layerNumber',
                  style: TextStyle(
                    fontSize: 12 + (layerNumber * 0.5),
                    fontWeight: FontWeight.bold,
                    color: isSelected
                        ? AppTheme.primaryColor
                        : isSoldOut
                            ? Colors.grey
                            : Colors.white,
                    shadows: const [
                      Shadow(
                        offset: Offset(0, 1),
                        blurRadius: 2,
                        color: Colors.black45,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    return buttons;
  }
}

/// Triangle painter
/// 目的: 三角形と層の塗りつぶしを描画
class TrianglePainter extends CustomPainter {
  final int baseLength;
  final List<LayerModel> layers;
  final int? selectedLayerNumber;

  TrianglePainter({
    required this.baseLength,
    required this.layers,
    this.selectedLayerNumber,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final width = size.width;
    final height = size.height;

    // 三角形の外枠を描画
    _drawTriangleOutline(canvas, width, height);

    // 各層を塗りつぶし
    _drawLayers(canvas, width, height);
  }

  void _drawTriangleOutline(Canvas canvas, double width, double height) {
    final paint = Paint()
      ..color = AppTheme.borderColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;

    final path = Path()
      ..moveTo(width / 2, 0) // 頂点
      ..lineTo(0, height) // 左下
      ..lineTo(width, height) // 右下
      ..close();

    canvas.drawPath(path, paint);
  }

  void _drawLayers(Canvas canvas, double width, double height) {
    final layerHeight = height / baseLength;

    for (int i = 0; i < layers.length; i++) {
      final layer = layers[i];
      final layerNumber = layer.layerNumber;
      final layerIndex = layerNumber - 1;

      // 層の販売進捗率
      final soldRatio = layer.positionsSold / layer.positionsCount;

      // 層の色を計算（下部の賞品リストと一致）
      Color layerColor;
      if (soldRatio >= 1.0) {
        // 完売
        layerColor = Colors.grey.withValues(alpha: 0.7);
      } else {
        // 層番号に応じた色（賞品リストと一致）
        layerColor = _getLayerColor(layerNumber);
      }

      // 選択されている層は明るく
      if (selectedLayerNumber == layerNumber) {
        layerColor = AppTheme.primaryColor.withValues(alpha: 0.7);
      }

      // 層の台形を描画
      _drawLayerTrapezoid(
        canvas,
        width,
        height,
        layerIndex,
        layerNumber,
        layerHeight,
        layerColor,
      );
    }
  }

  /// 層番号に応じた色を取得（LayerColorsクラスを使用）
  Color _getLayerColor(int layerNumber) {
    return LayerColors.getColor(layerNumber).withValues(alpha: 0.85);
  }

  void _drawLayerTrapezoid(
    Canvas canvas,
    double width,
    double height,
    int layerIndex,
    int layerNumber,
    double layerHeight,
    Color color,
  ) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    // 層の上端の幅
    final topWidth = layerIndex == 0
        ? 0.0
        : (width / baseLength) * layerIndex;
    // 層の下端の幅
    final bottomWidth = (width / baseLength) * layerNumber;

    // 層の中心X座標
    final centerX = width / 2;
    // 層の上端Y座標
    final topY = layerHeight * layerIndex;
    // 層の下端Y座標
    final bottomY = layerHeight * layerNumber;

    final path = Path();

    if (layerIndex == 0) {
      // 最上層は三角形
      path.moveTo(centerX, 0);
      path.lineTo(centerX - (bottomWidth / 2), bottomY);
      path.lineTo(centerX + (bottomWidth / 2), bottomY);
      path.close();
    } else {
      // それ以外は台形
      path.moveTo(centerX - (topWidth / 2), topY);
      path.lineTo(centerX - (bottomWidth / 2), bottomY);
      path.lineTo(centerX + (bottomWidth / 2), bottomY);
      path.lineTo(centerX + (topWidth / 2), topY);
      path.close();
    }

    canvas.drawPath(path, paint);

    // 層の境界線を描画
    final borderPaint = Paint()
      ..color = AppTheme.borderColor.withValues(alpha: 0.3)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    canvas.drawPath(path, borderPaint);
  }

  @override
  bool shouldRepaint(covariant TrianglePainter oldDelegate) {
    return oldDelegate.selectedLayerNumber != selectedLayerNumber ||
        oldDelegate.layers != layers;
  }
}
