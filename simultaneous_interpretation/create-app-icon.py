#!/usr/bin/env python3
"""
VoiceTranslate Pro - アプリケーションアイコン生成スクリプト

目的:
    Electronアプリ用のマイク/音声アイコンを生成
    - icon.png (512x512) - Electron用
    - icon.ico (Windows用)
    - icon.icns (macOS用)

必要なライブラリ:
    pip install Pillow
"""

from PIL import Image, ImageDraw
import os

def create_microphone_icon(size=512):
    """
    マイクアイコンを生成
    
    Args:
        size: アイコンサイズ（デフォルト512x512）
    
    Returns:
        PIL.Image: 生成されたアイコン画像
    """
    # 透明背景の画像を作成
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # グラデーションカラー（紫系）
    color_primary = (102, 126, 234)  # #667eea
    color_secondary = (118, 75, 162)  # #764ba2
    
    # マイク本体（楕円）
    mic_width = size * 0.35
    mic_height = size * 0.45
    mic_x = (size - mic_width) / 2
    mic_y = size * 0.15
    
    # マイク本体を描画
    draw.ellipse(
        [mic_x, mic_y, mic_x + mic_width, mic_y + mic_height],
        fill=color_primary,
        outline=None
    )
    
    # マイクスタンド（縦線）
    stand_width = size * 0.08
    stand_x = (size - stand_width) / 2
    stand_y = mic_y + mic_height
    stand_height = size * 0.25
    
    draw.rectangle(
        [stand_x, stand_y, stand_x + stand_width, stand_y + stand_height],
        fill=color_secondary
    )
    
    # マイクベース（横線）
    base_width = size * 0.4
    base_height = size * 0.08
    base_x = (size - base_width) / 2
    base_y = stand_y + stand_height
    
    draw.rectangle(
        [base_x, base_y, base_x + base_width, base_y + base_height],
        fill=color_secondary
    )
    
    # 音波エフェクト（3つの弧）
    wave_color = (*color_primary, 180)  # 半透明
    
    for i in range(3):
        offset = (i + 1) * size * 0.08
        wave_width = size * 0.04
        
        # 左側の音波
        left_x = mic_x - offset
        left_y = mic_y + mic_height * 0.3
        left_size = mic_height * 0.4
        
        draw.arc(
            [left_x, left_y, left_x + offset, left_y + left_size],
            start=270,
            end=90,
            fill=wave_color,
            width=int(wave_width)
        )
        
        # 右側の音波
        right_x = mic_x + mic_width
        right_y = left_y
        
        draw.arc(
            [right_x, right_y, right_x + offset, right_y + left_size],
            start=90,
            end=270,
            fill=wave_color,
            width=int(wave_width)
        )
    
    return img


def save_icon_files(img, output_dir='icons'):
    """
    各プラットフォーム用のアイコンファイルを保存
    
    Args:
        img: PIL.Image オブジェクト
        output_dir: 出力ディレクトリ
    """
    os.makedirs(output_dir, exist_ok=True)
    
    # 1. icon.png (512x512) - Electron/Linux用
    icon_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
    icon_512.save(os.path.join(output_dir, 'icon.png'), 'PNG')
    print(f'✅ 生成: {output_dir}/icon.png (512x512)')
    
    # 2. icon.ico (Windows用) - 複数サイズを含む
    ico_sizes = [(16, 16), (32, 32), (48, 48), (256, 256)]
    ico_images = [img.resize(size, Image.Resampling.LANCZOS) for size in ico_sizes]
    ico_images[0].save(
        os.path.join(output_dir, 'icon.ico'),
        format='ICO',
        sizes=ico_sizes
    )
    print(f'✅ 生成: {output_dir}/icon.ico (16,32,48,256)')
    
    # 3. tray-icon.png (システムトレイ用) - 32x32
    tray_icon = img.resize((32, 32), Image.Resampling.LANCZOS)
    tray_icon.save(os.path.join(output_dir, 'tray-icon.png'), 'PNG')
    print(f'✅ 生成: {output_dir}/tray-icon.png (32x32)')
    
    # 4. icon.icns (macOS用) - 注: Pillowだけでは完全なicnsは作れない
    # macOSでビルドする場合は、electron-builderが自動的にicon.pngから生成します
    print(f'ℹ️  macOS用icon.icnsは、electron-builderが自動生成します')


def main():
    """メイン処理"""
    print('🎨 VoiceTranslate Pro アイコン生成中...\n')
    
    # マイクアイコンを生成
    icon = create_microphone_icon(size=512)
    
    # 各プラットフォーム用に保存
    save_icon_files(icon)
    
    print('\n✨ アイコン生成完了！')
    print('\n📋 次のステップ:')
    print('1. Electronアプリを再ビルド: npm run build:electron')
    print('2. アプリを起動: npm run electron')
    print('3. Windowsタスクバーでアイコンを確認')


if __name__ == '__main__':
    try:
        main()
    except ImportError:
        print('❌ エラー: Pillowライブラリがインストールされていません')
        print('\n以下のコマンドでインストールしてください:')
        print('pip install Pillow')
    except Exception as e:
        print(f'❌ エラー: {e}')

