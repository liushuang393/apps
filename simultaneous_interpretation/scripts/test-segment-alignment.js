#!/usr/bin/env node

const assert = require('assert');
const { SegmentAlignmentManager } = require('../voicetranslate-segment-alignment.js');
const { TextPathProcessor } = require('../voicetranslate-path-processors.js');

function testStableInput() {
    const manager = new SegmentAlignmentManager();
    const segment = manager.createSegment({ id: 'seg_a', sourceLang: 'zh' });
    assert.strictEqual(segment.id, 'seg_a');

    const updated = manager.updateInput('seg_a', '你和我会永远一起走下去。', {
        isFinal: true,
        sourceLang: 'zh',
        source: 'live-sra'
    });

    assert.strictEqual(updated.input.text, '你和我会永远一起走下去。');
    assert.strictEqual(updated.input.isFinal, true);
    assert.strictEqual(updated.input.source, 'live-sra');
}

function testResponseRouting() {
    const manager = new SegmentAlignmentManager();
    manager.createSegment({ id: 'seg_b' });
    manager.enqueueResponseSegment('seg_b');

    const bound = manager.bindNextResponse('resp_b');
    assert.strictEqual(bound.id, 'seg_b');
    assert.strictEqual(manager.getSegmentByResponseId('resp_b').id, 'seg_b');

    manager.appendOutputTextByResponse('resp_b', '君と僕は');
    manager.appendOutputTextByResponse('resp_b', 'ずっと一緒に歩んでいく。');
    manager.appendOutputAudioByResponse('resp_b');
    manager.markOutputAudioDone('resp_b');
    manager.markOutputTextDone('resp_b');
    manager.markResponseDone('resp_b');

    const segment = manager.getSegment('seg_b');
    assert.strictEqual(segment.output.text, '君と僕はずっと一緒に歩んでいく。');
    assert.strictEqual(segment.output.audioChunkCount, 1);
    assert.strictEqual(segment.output.audioDone, true);
    assert.strictEqual(segment.output.isFinal, true);
    assert.strictEqual(segment.status, 'done');
}

function testUnknownResponseDoesNotMutateNewestSegment() {
    const manager = new SegmentAlignmentManager();
    manager.createSegment({ id: 'seg_c' });

    assert.strictEqual(manager.appendOutputTextByResponse('unknown_response', 'bad'), null);
    assert.strictEqual(manager.appendOutputAudioByResponse('unknown_response'), null);
    assert.strictEqual(manager.getSegment('seg_c').output.text, '');
    assert.strictEqual(manager.getSegment('seg_c').output.audioChunkCount, 0);
}

function testPendingInputOrder() {
    const manager = new SegmentAlignmentManager();
    manager.createSegment({ id: 'seg_1' });
    manager.createSegment({ id: 'seg_2' });
    manager.enqueueInputSegment('seg_1');
    manager.enqueueInputSegment('seg_2');

    const first = manager.completeNextInput('第一句。', { source: 'live-sra' });
    const second = manager.completeNextInput('第二句。', { source: 'live-sra' });

    assert.strictEqual(first.id, 'seg_1');
    assert.strictEqual(second.id, 'seg_2');
    assert.strictEqual(manager.getSegment('seg_1').input.text, '第一句。');
    assert.strictEqual(manager.getSegment('seg_2').input.text, '第二句。');
}

function testOutOfOrderResponseBeforeInputStillAligns() {
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
    assert.strictEqual(manager.getSegmentByResponseId('resp_out_of_order').id, segment.id);
    assert.strictEqual(segment.input.text, '先に音声翻訳イベントが届いた。');
    assert.strictEqual(segment.output.text, '先に翻訳が届いた。');
}

function testItemIdResolutionOrderIndependent() {
    const manager = new SegmentAlignmentManager();
    manager.createSegment({ id: 'seg_1' });
    manager.createSegment({ id: 'seg_2' });
    manager.bindItemId('item_1', 'seg_1');
    manager.bindItemId('item_2', 'seg_2');

    assert.strictEqual(manager.getSegmentByItemId('item_2').id, 'seg_2');
    assert.strictEqual(manager.getSegmentByItemId('item_1').id, 'seg_1');
    assert.strictEqual(manager.getSegmentByItemId('unknown'), null);
}

function testLateTranscriptionRoutesToOriginalSegment() {
    const manager = new SegmentAlignmentManager();
    const first = manager.createSegment({ status: 'collecting' });
    manager.bindItemId('item_late', first.id);

    manager.createSegment({ status: 'collecting' }); // 次グループ作成（flush 相当）
    const resolved = manager.getSegmentByItemId('item_late');
    assert.strictEqual(resolved.id, first.id);

    manager.updateInput(resolved.id, '遅れて届いた原文。', { isFinal: true, source: 'live-sra' });
    assert.strictEqual(manager.getSegment(first.id).input.text, '遅れて届いた原文。');
}

function testIncreasingSeq() {
    const manager = new SegmentAlignmentManager();
    const a = manager.createSegment({});
    const b = manager.createSegment({});
    assert.ok(b.seq > a.seq);
}

function testTrimPrunesPendingQueues() {
    const manager = new SegmentAlignmentManager({ maxSegments: 2 });
    const stale = manager.createSegment({ id: 'seg_stale' });
    manager.enqueueInputSegment(stale.id);
    manager.enqueueResponseSegment(stale.id);

    manager.createSegment({ id: 'seg_x' });
    manager.createSegment({ id: 'seg_y' }); // seg_stale が trim される

    assert.strictEqual(manager.getSegment('seg_stale'), null);
    assert.ok(!manager.pendingInputSegments.includes('seg_stale'));
    assert.ok(!manager.pendingResponseSegments.includes('seg_stale'));
    // pending 掃除済みなので幽霊 segment が復活しない
    assert.strictEqual(manager.completeNextInput('遅延転写。', { source: 'live-sra' }), null);
    assert.strictEqual(manager.bindNextResponse('resp_stale'), null);
    assert.strictEqual(manager.segments.size, 2);
}

function testConservativeLanguageDetection() {
    const processor = new TextPathProcessor(null, {});

    assert.strictEqual(processor.detectLanguageFromTranscript('今日は良い天気です。'), 'ja');
    assert.strictEqual(processor.detectLanguageFromTranscript('会議資料確認'), 'auto');
    assert.strictEqual(processor.detectLanguageFromTranscript('这是中文。'), 'zh');
    assert.strictEqual(processor.detectLanguageFromTranscript('Xin chào mọi người.'), 'vi');
    assert.strictEqual(processor.detectLanguageFromTranscript('Hello everyone.'), 'en');
}

testStableInput();
testResponseRouting();
testUnknownResponseDoesNotMutateNewestSegment();
testPendingInputOrder();
testOutOfOrderResponseBeforeInputStillAligns();
testItemIdResolutionOrderIndependent();
testLateTranscriptionRoutesToOriginalSegment();
testIncreasingSeq();
testTrimPrunesPendingQueues();
testConservativeLanguageDetection();

console.log('SegmentAlignmentManager behavior ok');
