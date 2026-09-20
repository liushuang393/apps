"""実モデルが返すスカラー音声長を、診断ハーネスが欠落なく扱うことを確認する。"""

import unittest

import torch
import probe_local_seamless as probe


class SeamlessAudioLengthTests(unittest.TestCase):
    """単一入力のスカラー・配列形式と、不正な長さを検証する。"""

    def test_scalar_length(self) -> None:
        """実機で得られた0次元Tensorを受け入れる。"""
        self.assertEqual(probe.audio_length(torch.tensor(16000), 18000), 16000)

    def test_single_element_length(self) -> None:
        """1要素Tensorにも同じ長さを返す。"""
        self.assertEqual(probe.audio_length(torch.tensor([16000]), 18000), 16000)

    def test_invalid_lengths(self) -> None:
        """空・複数入力・無音長・範囲外を正常音声として切り出さない。"""
        for value in [[], [2, 3], [0], [-1], [18001]]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                probe.audio_length(torch.tensor(value), 18000)


if __name__ == "__main__":
    unittest.main()
