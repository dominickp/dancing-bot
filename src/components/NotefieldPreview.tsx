import { useMemo } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import type { MinimapHoldBand, MinimapRow } from '../lib/minimap';
import type { ParityDiagnosticKind } from '../lib/parity';
import type { Panel, TimedNoteEvent } from '../lib/simfile';

interface HoldSegmentView {
  panel: Panel;
  startBeat: number;
  endBeat: number;
  kind: 'hold' | 'roll';
}

interface BeatGuide {
  beat: number;
  isMeasure: boolean;
}

interface ParityHintView {
  beat: number;
  rowIndex: number;
  kinds: ParityDiagnosticKind[];
  labels: string[];
}

interface NotefieldPreviewProps {
  chartVerticalOffset: number;
  chartContentHeight: number;
  displayBeat: number;
  explosionRefs: MutableRefObject<Record<Panel, HTMLDivElement | null>>;
  handlePlayfieldPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  getNoteDetailStyle: (event: TimedNoteEvent) => CSSProperties | null;
  getHoldStyle: (segment: HoldSegmentView) => CSSProperties;
  getHoldCapStyle: (segment: HoldSegmentView) => CSSProperties;
  getNoteFrameStyle: (event: TimedNoteEvent) => CSSProperties;
  getNoteStyle: (event: TimedNoteEvent) => CSSProperties;
  getNoteUnderlayStyle: (event: TimedNoteEvent) => CSSProperties | null;
  getReceptorStyle: (panel: Panel) => CSSProperties;
  handleMinimapPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleMinimapPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleMinimapKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  measureGuideLayerRef: MutableRefObject<HTMLDivElement | null>;
  minimapHoldBands: MinimapHoldBand[];
  minimapParityHints: ParityHintView[];
  minimapRows: MinimapRow[];
  minimapRef: MutableRefObject<HTMLDivElement | null>;
  notefieldFrameRef: MutableRefObject<HTMLDivElement | null>;
  isLoading: boolean;
  panelOrder: readonly Panel[];
  pixelsPerBeat: number;
  isPlayfieldDragging: boolean;
  playfieldStyle: CSSProperties;
  receptorOffset: number;
  receptorRefs: MutableRefObject<Record<Panel, HTMLDivElement | null>>;
  scrollLayerRef: MutableRefObject<HTMLDivElement | null>;
  totalChartBeats: number;
  viewportHeight: number;
  visibleBeatGuides: BeatGuide[];
  visibleParityHints: ParityHintView[];
  visibleEvents: TimedNoteEvent[];
  visibleHolds: HoldSegmentView[];
  botWindow: ReactNode;
}

export function NotefieldPreview({
  chartVerticalOffset,
  chartContentHeight,
  displayBeat,
  explosionRefs,
  handlePlayfieldPointerDown,
  getNoteDetailStyle,
  getHoldStyle,
  getHoldCapStyle,
  getNoteFrameStyle,
  getNoteStyle,
  getNoteUnderlayStyle,
  getReceptorStyle,
  handleMinimapPointerDown,
  handleMinimapPointerMove,
  handleMinimapKeyDown,
  measureGuideLayerRef,
  minimapHoldBands,
  minimapParityHints,
  minimapRows,
  minimapRef,
  notefieldFrameRef,
  isLoading,
  panelOrder,
  pixelsPerBeat,
  isPlayfieldDragging,
  playfieldStyle,
  receptorOffset,
  receptorRefs,
  scrollLayerRef,
  totalChartBeats,
  viewportHeight,
  visibleBeatGuides,
  visibleParityHints,
  visibleEvents,
  visibleHolds,
  botWindow,
}: NotefieldPreviewProps) {
  const getMinimapHintTone = (hint: ParityHintView): string => {
    const priority: ParityDiagnosticKind[] = ['spin', 'double-step', 'crossover', 'bracket', 'footswitch'];

    for (const kind of priority) {
      if (hint.kinds.includes(kind)) {
        return kind;
      }
    }

    return 'mixed';
  };

  const minimapHoldElements = useMemo(
    () =>
      minimapHoldBands.map((segment) => (
        <div
          key={`${segment.kind}-${segment.startBeat}-${segment.endBeat}`}
          className={`minimap-hold minimap-hold-${segment.kind}`}
          style={{
            top: `${(segment.startBeat / totalChartBeats) * 100}%`,
            height: `${Math.max(((segment.endBeat - segment.startBeat) / totalChartBeats) * 100, 0.32)}%`,
            opacity: segment.intensity,
          }}
        />
      )),
    [minimapHoldBands, totalChartBeats],
  );

  const minimapParityHintElements = useMemo(
    () =>
      minimapParityHints.map((hint) => {
        const tone = getMinimapHintTone(hint);

        return (
          <div
            key={`minimap-hint-${hint.rowIndex}-${hint.beat}`}
            className={`minimap-pattern-marker minimap-pattern-marker-${tone}${hint.kinds.length > 1 ? ' is-multi' : ''}`}
            style={{ top: `${(hint.beat / totalChartBeats) * 100}%` }}
            title={hint.labels.join(' / ')}
          >
            <span className="minimap-pattern-marker-core" />
          </div>
        );
      }),
    [minimapParityHints, totalChartBeats],
  );

  const minimapRowElements = useMemo(
    () =>
      minimapRows.map((row) => (
        <div
          key={row.beat}
          className="minimap-row"
          style={{
            top: `${(row.beat / totalChartBeats) * 100}%`,
            height: `${Math.min(1 + row.noteCount, 4)}px`,
            opacity: 0.2 + row.density * 0.8,
            background: row.quantizationColor,
            transform: `scaleX(${Math.max(row.density, 0.08)})`,
          }}
          title={`${row.quantizationKind} @ beat ${row.beat.toFixed(3)}`}
        />
      )),
    [minimapRows, totalChartBeats],
  );

  return (
    <section className="notefield-panel" aria-label="Interactive notefield preview">
      <div className="notefield-layout">
        <div className="notefield-frame" ref={notefieldFrameRef} tabIndex={-1} aria-busy={isLoading}>
          <div
            className={`notefield-playfield${isPlayfieldDragging ? ' is-dragging' : ''}`}
            style={playfieldStyle}
            onPointerDown={handlePlayfieldPointerDown}
          >
            <div className="playfield-track">
              <div className="receptor-row" aria-hidden="true">
                {panelOrder.map((panel) => (
                  <div
                    key={panel}
                    className={`receptor receptor-${panel}`}
                    ref={(element) => {
                      receptorRefs.current[panel] = element;
                    }}
                  >
                    <div className="receptor-sprite" style={getReceptorStyle(panel)} />
                    <div
                      className={`receptor-explosion receptor-explosion-${panel}`}
                      ref={(element) => {
                        explosionRefs.current[panel] = element;
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="lane-grid" style={{ height: receptorOffset + viewportHeight }}>
                <div className="measure-guide-layer" ref={measureGuideLayerRef} style={{ height: chartContentHeight }}>
                  {visibleBeatGuides.map(({ beat, isMeasure }) => (
                    <div
                      key={beat}
                      className={`measure-guide${isMeasure ? ' measure-guide-major' : ' measure-guide-minor'}`}
                      style={{ top: chartVerticalOffset + beat * pixelsPerBeat }}
                    >
                      {isMeasure ? <span>M {beat / 4}</span> : null}
                    </div>
                  ))}

                  {visibleParityHints.map((hint) => (
                    <div
                      key={`${hint.rowIndex}-${hint.beat}`}
                      className="parity-hint"
                      style={{ top: chartVerticalOffset + hint.beat * pixelsPerBeat }}
                    >
                      {hint.labels.map((label) => (
                        <span key={label} className="parity-hint-chip">
                          {label}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>

                <div className="chart-scroll-layer" ref={scrollLayerRef} style={{ height: chartContentHeight }}>
                  {panelOrder.map((panel) => (
                    <div key={panel} className="lane-column" data-panel={panel} style={{ height: chartContentHeight }}>
                      {visibleHolds
                        .filter((segment) => segment.panel === panel)
                        .flatMap((segment) => {
                          const segmentKey = `${segment.panel}-${segment.startBeat}-${segment.endBeat}-${segment.kind}`;

                          return [
                            <div key={`${segmentKey}-body`} className="hold-body" style={getHoldStyle(segment)} />,
                            <div key={`${segmentKey}-cap`} className="hold-cap" style={getHoldCapStyle(segment)} />,
                          ];
                        })}

                      {visibleEvents
                        .filter((event) => event.panel === panel)
                        .map((event) => {
                          const detailStyle = getNoteDetailStyle(event);
                          const underlayStyle = getNoteUnderlayStyle(event);

                          return (
                            <div
                              key={`${event.panel}-${event.measureIndex}-${event.rowIndex}-${event.kind}`}
                              className={`lane-note ${event.kind}`}
                              style={getNoteFrameStyle(event)}
                              title={`${event.panel} ${event.kind} @ beat ${event.beat.toFixed(3)}`}
                            >
                              {underlayStyle ? <div className="lane-note-underlay" style={underlayStyle} /> : null}
                              <div
                                className={`lane-note-overlay${underlayStyle ? ' lane-note-overlay-blended' : ''}`}
                                style={getNoteStyle(event)}
                              />
                              {detailStyle ? <div className="lane-note-detail" style={detailStyle} /> : null}
                            </div>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="notefield-loader" role="status" aria-live="polite">
              <div className="notefield-loader-spinner" aria-hidden="true" />
              <div className="notefield-loader-copy">
                <strong>Loading audio</strong>
                <span>Starting playback once the track is ready.</span>
              </div>
            </div>
          ) : null}

          {botWindow}
        </div>

        <aside className="minimap-panel" aria-label="Song minimap">
          <div className="minimap-header">
            <h3>Minimap</h3>
          </div>

          <div
            className="minimap-track"
            ref={minimapRef}
            role="slider"
            tabIndex={0}
            aria-label="Chart seek position"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={Math.round(totalChartBeats * 100) / 100}
            aria-valuenow={Number(displayBeat.toFixed(2))}
            aria-valuetext={`Beat ${displayBeat.toFixed(2)}`}
            data-keyboard-local="true"
            onPointerDown={handleMinimapPointerDown}
            onPointerMove={handleMinimapPointerMove}
            onKeyDown={handleMinimapKeyDown}
          >
            {minimapHoldElements}
            {minimapParityHintElements}
            {minimapRowElements}
            <div className="minimap-playhead" style={{ top: `${(displayBeat / totalChartBeats) * 100}%` }} />
          </div>
        </aside>
      </div>
    </section>
  );
}