const { SegmentAlignmentManager } = require('../../voicetranslate-segment-alignment.js');
const { TextPathProcessor } = require('../../voicetranslate-path-processors.js');

describe('SegmentAlignmentManager', () => {
    test('creates a stable segment id and stores input text', () => {
        const manager = new SegmentAlignmentManager();
        const segment = manager.createSegment({ id: 'seg_a', sourceLang: 'zh' });

        expect(segment.id).toBe('seg_a');

        const updated = manager.updateInput('seg_a', '你和我会永远一起走下去。', {
            isFinal: true,
            sourceLang: 'zh',
            source: 'live-sra'
        });

        expect(updated.id).toBe('seg_a');
        expect(updated.input.text).toBe('你和我会永远一起走下去。');
        expect(updated.input.isFinal).toBe(true);
        expect(updated.input.source).toBe('live-sra');
    });

    test('binds response id and routes output text/audio to the same segment', () => {
        const manager = new SegmentAlignmentManager();
        manager.createSegment({ id: 'seg_b' });
        manager.enqueueResponseSegment('seg_b');

        const bound = manager.bindNextResponse('resp_b');
        expect(bound.id).toBe('seg_b');
        expect(manager.getSegmentByResponseId('resp_b').id).toBe('seg_b');

        manager.appendOutputTextByResponse('resp_b', '君と僕は');
        manager.appendOutputTextByResponse('resp_b', 'ずっと一緒に歩んでいく。');
        manager.appendOutputAudioByResponse('resp_b');
        manager.markOutputAudioDone('resp_b');
        manager.markOutputTextDone('resp_b');
        manager.markResponseDone('resp_b');

        const segment = manager.getSegment('seg_b');
        expect(segment.output.text).toBe('君と僕はずっと一緒に歩んでいく。');
        expect(segment.output.audioChunkCount).toBe(1);
        expect(segment.output.audioDone).toBe(true);
        expect(segment.output.isFinal).toBe(true);
        expect(segment.status).toBe('done');
    });

    test('does not write unknown response ids into the newest segment', () => {
        const manager = new SegmentAlignmentManager();
        manager.createSegment({ id: 'seg_c' });

        expect(manager.appendOutputTextByResponse('unknown_response', 'bad')).toBeNull();
        expect(manager.appendOutputAudioByResponse('unknown_response')).toBeNull();
        expect(manager.getSegment('seg_c').output.text).toBe('');
        expect(manager.getSegment('seg_c').output.audioChunkCount).toBe(0);
    });

    test('maps pending input transcription by commit order', () => {
        const manager = new SegmentAlignmentManager();
        manager.createSegment({ id: 'seg_1' });
        manager.createSegment({ id: 'seg_2' });
        manager.enqueueInputSegment('seg_1');
        manager.enqueueInputSegment('seg_2');

        const first = manager.completeNextInput('第一句。', { source: 'live-sra' });
        const second = manager.completeNextInput('第二句。', { source: 'live-sra' });

        expect(first.id).toBe('seg_1');
        expect(second.id).toBe('seg_2');
        expect(manager.getSegment('seg_1').input.text).toBe('第一句。');
        expect(manager.getSegment('seg_2').input.text).toBe('第二句。');
    });

    test('dequeue keeps FIFO aligned when a transcription fails', () => {
        const manager = new SegmentAlignmentManager();
        manager.createSegment({ id: 'seg_1' });
        manager.createSegment({ id: 'seg_2' });
        manager.enqueueInputSegment('seg_1');
        manager.enqueueInputSegment('seg_2');

        // seg_1 の認識失敗で待ちキューから除去 → 後続の確定が seg_2 にずれずに入る
        manager.dequeueInputSegment('seg_1');
        const next = manager.completeNextInput('第二句。', { source: 'live-sra' });

        expect(next.id).toBe('seg_2');
        expect(manager.getSegment('seg_2').input.text).toBe('第二句。');
        expect(manager.getSegment('seg_1').input.text).toBe('');
    });

    test('keeps output aligned when response arrives before input text', () => {
        const manager = new SegmentAlignmentManager();
        manager.createSegment({ id: 'seg_out_of_order' });
        manager.enqueueResponseSegment('seg_out_of_order');

        manager.bindNextResponse('resp_out_of_order');
        manager.appendOutputTextByResponse('resp_out_of_order', '先に翻訳が届いた。');
        manager.updateInput('seg_out_of_order', '先に音声翻訳イベントが届いた。', {
            isFinal: true,
            source: 'live-sra'
        });

        const segment = manager.getSegment('seg_out_of_order');
        expect(manager.getSegmentByResponseId('resp_out_of_order').id).toBe(segment.id);
        expect(segment.input.text).toBe('先に音声翻訳イベントが届いた。');
        expect(segment.output.text).toBe('先に翻訳が届いた。');
    });

    test('resolves input by item_id regardless of completion order', () => {
        const manager = new SegmentAlignmentManager();
        manager.createSegment({ id: 'seg_1' });
        manager.createSegment({ id: 'seg_2' });
        manager.bindItemId('item_1', 'seg_1');
        manager.bindItemId('item_2', 'seg_2');

        // 後発の item_2 が先に確定しても seg_2 に入る（FIFO 順非依存）
        expect(manager.getSegmentByItemId('item_2')?.id).toBe('seg_2');
        expect(manager.getSegmentByItemId('item_1')?.id).toBe('seg_1');
        expect(manager.getSegmentByItemId('unknown')).toBeNull();
    });

    test('item_id binding routes a late transcription to its original segment', () => {
        const manager = new SegmentAlignmentManager();
        const first = manager.createSegment({ status: 'collecting' });
        manager.bindItemId('item_late', first.id);

        // flush 相当: 次グループの segment が作られた後でも、遅延転写は元の segment に戻る
        manager.createSegment({ status: 'collecting' });
        const resolved = manager.getSegmentByItemId('item_late');
        expect(resolved?.id).toBe(first.id);

        manager.updateInput(resolved!.id, '遅れて届いた原文。', {
            isFinal: true,
            source: 'live-sra'
        });
        expect(manager.getSegment(first.id)?.input.text).toBe('遅れて届いた原文。');
    });

    test('assigns increasing seq for stable left/right ordering', () => {
        const manager = new SegmentAlignmentManager();
        const a = manager.createSegment({});
        const b = manager.createSegment({});
        const c = manager.createSegment({});
        expect(b.seq).toBeGreaterThan(a.seq);
        expect(c.seq).toBeGreaterThan(b.seq);
    });

    test('aggregates a full committed→response→delta→done sequence to one segment', () => {
        const manager = new SegmentAlignmentManager();
        const seg = manager.createSegment({ status: 'collecting' });

        // input_audio_buffer.committed → item_id バインド
        manager.bindItemId('item_seq', seg.id);
        // transcription.completed
        manager.updateInput(manager.getSegmentByItemId('item_seq')!.id, '原文です。', {
            isFinal: true,
            source: 'live-sra'
        });
        // response.created
        manager.enqueueResponseSegment(seg.id);
        manager.bindNextResponse('resp_seq');
        // transcript delta / audio delta / done
        manager.appendOutputTextByResponse('resp_seq', '訳文です。');
        manager.appendOutputAudioByResponse('resp_seq');
        manager.markOutputAudioDone('resp_seq');
        manager.markOutputTextDone('resp_seq');
        manager.markResponseDone('resp_seq');

        const final = manager.getSegment(seg.id);
        expect(final?.input.text).toBe('原文です。');
        expect(final?.output.text).toBe('訳文です。');
        expect(final?.output.audioChunkCount).toBe(1);
        expect(final?.status).toBe('done');
        expect(manager.getSegmentByResponseId('resp_seq')?.id).toBe(seg.id);
    });

    test('prunes trimmed ids from pending queues and prevents resurrection', () => {
        const manager = new SegmentAlignmentManager({ maxSegments: 2 });

        // 古い segment を pending に積んだまま放置する（転写/応答が来ないケース）
        const stale = manager.createSegment({ id: 'seg_stale' });
        manager.enqueueInputSegment(stale.id);
        manager.enqueueResponseSegment(stale.id);

        // maxSegments を超える新規 segment を作り、seg_stale を trim させる
        manager.createSegment({ id: 'seg_x' });
        manager.createSegment({ id: 'seg_y' });

        expect(manager.getSegment('seg_stale')).toBeNull();
        expect(manager.pendingInputSegments).not.toContain('seg_stale');
        expect(manager.pendingResponseSegments).not.toContain('seg_stale');

        // pending が掃除済みなので、shift しても空 segment が復活しない
        expect(manager.completeNextInput('遅延転写。', { source: 'live-sra' })).toBeNull();
        expect(manager.bindNextResponse('resp_stale')).toBeNull();
        expect(manager.getSegment('seg_stale')).toBeNull();
        expect(manager.segments.size).toBe(2);
    });

    test('keeps CJK language detection conservative', () => {
        const processor = new TextPathProcessor(null, {});

        expect(processor.detectLanguageFromTranscript('今日は良い天気です。')).toBe('ja');
        expect(processor.detectLanguageFromTranscript('会議資料確認')).toBe('auto');
        expect(processor.detectLanguageFromTranscript('这是中文。')).toBe('zh');
        expect(processor.detectLanguageFromTranscript('Xin chào mọi người.')).toBe('vi');
        expect(processor.detectLanguageFromTranscript('Hello everyone.')).toBe('en');
    });
});
