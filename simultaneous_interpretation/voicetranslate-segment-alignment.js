/**
 * VoiceTranslate Pro - Segment Alignment Manager
 *
 * Keeps SRA/ASR input text, STS output transcript, and STS output audio tied to
 * the same stable segment id. This is deliberately framework-free so it can run
 * in Electron, the browser page, and the Chrome extension.
 */

class SegmentAlignmentManager {
    constructor(options = {}) {
        this.maxSegments = options.maxSegments || 200;
        this.segments = new Map();
        this.responseToSegment = new Map();
        this.itemIdToSegment = new Map();
        this.pendingInputSegments = [];
        this.pendingResponseSegments = [];
        // 作成順を表す単調増加シーケンス。UI の左右並び順を桁揃え依存の文字列比較なしで一致させる。
        this.sequenceCounter = 0;
    }

    createSegment(metadata = {}) {
        const id =
            metadata.id ||
            metadata.segmentId ||
            'seg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
        const now = Date.now();
        const segment = {
            id,
            seq: ++this.sequenceCounter,
            createdAt: metadata.createdAt || now,
            updatedAt: now,
            status: metadata.status || 'collecting',
            audio: {
                chunks: metadata.audioChunks || [],
                durationMs: metadata.durationMs || metadata.duration || 0,
                sampleRate: metadata.sampleRate || 24000
            },
            input: {
                text: metadata.inputText || '',
                isFinal: !!metadata.inputFinal,
                sourceLang: metadata.sourceLang || metadata.language || null,
                confidence: metadata.confidence ?? null,
                source: metadata.inputSource || null
            },
            output: {
                responseId: metadata.responseId || null,
                text: metadata.outputText || '',
                isFinal: !!metadata.outputFinal,
                audioChunkCount: 0,
                audioDone: false
            },
            timing: {
                firstAudioAt: metadata.firstAudioAt || now,
                inputTextFinalAt: null,
                responseCreatedAt: null,
                firstOutputAudioAt: null,
                outputTextDoneAt: null,
                responseDoneAt: null
            },
            errors: []
        };

        this.segments.set(id, segment);
        this.trimOldSegments();
        return segment;
    }

    ensureSegment(segmentOrId, metadata = {}) {
        if (segmentOrId && typeof segmentOrId === 'object') {
            const id = segmentOrId.id || segmentOrId.segmentId;
            if (id && this.segments.has(id)) {
                return this.updateSegment(id, metadata);
            }
            return this.createSegment({ ...metadata, id });
        }

        if (segmentOrId && this.segments.has(segmentOrId)) {
            return this.updateSegment(segmentOrId, metadata);
        }

        return this.createSegment({ ...metadata, id: segmentOrId || metadata.id });
    }

    updateSegment(segmentId, patch = {}) {
        const segment = this.segments.get(segmentId);
        if (!segment) {
            return null;
        }

        Object.assign(segment, patch);
        segment.updatedAt = Date.now();
        return segment;
    }

    getSegment(segmentId) {
        return this.segments.get(segmentId) || null;
    }

    getSegmentByResponseId(responseId) {
        const segmentId = this.responseToSegment.get(responseId);
        return segmentId ? this.getSegment(segmentId) : null;
    }

    /**
     * Realtime API の item_id（input_audio_buffer.committed で確定）を segment に対応付ける。
     * これにより非同期で前後する transcription.completed を正しい segment へ確実に戻せる。
     *
     * @param {string} itemId
     * @param {string} segmentId
     */
    bindItemId(itemId, segmentId) {
        if (!itemId || !segmentId || !this.segments.has(segmentId)) {
            return;
        }
        this.itemIdToSegment.set(itemId, segmentId);
    }

    /**
     * @param {string} itemId
     * @returns {Object|null}
     */
    getSegmentByItemId(itemId) {
        const segmentId = itemId ? this.itemIdToSegment.get(itemId) : null;
        return segmentId ? this.getSegment(segmentId) : null;
    }

    enqueueInputSegment(segmentId) {
        if (!segmentId || this.pendingInputSegments.includes(segmentId)) {
            return;
        }
        this.pendingInputSegments.push(segmentId);
    }

    completeNextInput(text, metadata = {}) {
        const segmentId = metadata.segmentId || this.pendingInputSegments.shift();
        if (!segmentId) {
            return null;
        }
        return this.updateInput(segmentId, text, { ...metadata, isFinal: true });
    }

    updateInput(segmentId, text, metadata = {}) {
        const segment = this.ensureSegment(segmentId, metadata);
        segment.input.text = text || '';
        segment.input.isFinal = metadata.isFinal ?? segment.input.isFinal;
        segment.input.sourceLang =
            metadata.sourceLang || metadata.language || segment.input.sourceLang;
        segment.input.confidence = metadata.confidence ?? segment.input.confidence;
        segment.input.source = metadata.source || segment.input.source;
        segment.status = metadata.status || segment.status;
        segment.updatedAt = Date.now();
        if (segment.input.isFinal) {
            segment.timing.inputTextFinalAt = segment.timing.inputTextFinalAt || Date.now();
        }
        return segment;
    }

    enqueueResponseSegment(segmentId) {
        if (!segmentId || this.pendingResponseSegments.includes(segmentId)) {
            return;
        }
        this.pendingResponseSegments.push(segmentId);
    }

    bindNextResponse(responseId, metadata = {}) {
        const segmentId = metadata.segmentId || this.pendingResponseSegments.shift();
        if (!segmentId || !responseId) {
            return null;
        }
        return this.bindResponse(segmentId, responseId);
    }

    bindResponse(segmentId, responseId) {
        const segment = this.ensureSegment(segmentId);
        segment.output.responseId = responseId;
        segment.status = 'responding';
        segment.timing.responseCreatedAt = segment.timing.responseCreatedAt || Date.now();
        segment.updatedAt = Date.now();
        this.responseToSegment.set(responseId, segment.id);
        return segment;
    }

    appendOutputTextByResponse(responseId, delta) {
        const segment = this.getSegmentByResponseId(responseId);
        if (!segment || !delta) {
            return null;
        }
        segment.output.text += delta;
        segment.updatedAt = Date.now();
        return segment;
    }

    setOutputTextByResponse(responseId, text, metadata = {}) {
        const segment = this.getSegmentByResponseId(responseId);
        if (!segment) {
            return null;
        }
        segment.output.text = text || '';
        segment.output.isFinal = metadata.isFinal ?? segment.output.isFinal;
        segment.updatedAt = Date.now();
        if (segment.output.isFinal) {
            segment.timing.outputTextDoneAt = segment.timing.outputTextDoneAt || Date.now();
        }
        return segment;
    }

    markOutputTextDone(responseId) {
        const segment = this.getSegmentByResponseId(responseId);
        if (!segment) {
            return null;
        }
        segment.output.isFinal = true;
        segment.timing.outputTextDoneAt = segment.timing.outputTextDoneAt || Date.now();
        segment.updatedAt = Date.now();
        return segment;
    }

    appendOutputAudioByResponse(responseId) {
        const segment = this.getSegmentByResponseId(responseId);
        if (!segment) {
            return null;
        }
        segment.output.audioChunkCount++;
        segment.timing.firstOutputAudioAt = segment.timing.firstOutputAudioAt || Date.now();
        segment.updatedAt = Date.now();
        return segment;
    }

    markOutputAudioDone(responseId) {
        const segment = this.getSegmentByResponseId(responseId);
        if (!segment) {
            return null;
        }
        segment.output.audioDone = true;
        segment.updatedAt = Date.now();
        return segment;
    }

    markResponseDone(responseId) {
        const segment = this.getSegmentByResponseId(responseId);
        if (!segment) {
            return null;
        }
        segment.status = 'done';
        segment.timing.responseDoneAt = segment.timing.responseDoneAt || Date.now();
        segment.updatedAt = Date.now();
        return segment;
    }

    recordError(segmentId, error) {
        const segment = this.ensureSegment(segmentId);
        segment.status = 'error';
        segment.errors.push({
            message: error?.message || String(error),
            timestamp: Date.now()
        });
        segment.updatedAt = Date.now();
        return segment;
    }

    clear() {
        this.segments.clear();
        this.responseToSegment.clear();
        this.itemIdToSegment.clear();
        this.pendingInputSegments = [];
        this.pendingResponseSegments = [];
    }

    trimOldSegments() {
        while (this.segments.size > this.maxSegments) {
            const oldest = this.segments.keys().next().value;
            this.segments.delete(oldest);
            for (const [responseId, segmentId] of this.responseToSegment.entries()) {
                if (segmentId === oldest) {
                    this.responseToSegment.delete(responseId);
                }
            }
            for (const [itemId, segmentId] of this.itemIdToSegment.entries()) {
                if (segmentId === oldest) {
                    this.itemIdToSegment.delete(itemId);
                }
            }
            // trim 済み id を pending queue からも除去する。
            // 残すと completeNextInput()/bindNextResponse() の shift が
            // ensureSegment() 経由で空の segment を「復活」させてしまう。
            this.pendingInputSegments = this.pendingInputSegments.filter(
                (segmentId) => segmentId !== oldest
            );
            this.pendingResponseSegments = this.pendingResponseSegments.filter(
                (segmentId) => segmentId !== oldest
            );
        }
    }
}

if (typeof globalThis !== 'undefined') {
    globalThis.SegmentAlignmentManager = SegmentAlignmentManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SegmentAlignmentManager };
}
