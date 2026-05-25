import type { CSSProperties, MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { Panel, TimedNoteEvent } from '../lib/simfile';

interface HoldSegmentView {
  panel: Panel;
  startBeat: number;
  endBeat: number;
  kind: 'hold' | 'roll';
}

interface MinimapMeasureView {
  measureIndex: number;
  startBeat: number;
  density: number;
}

interface BeatGuide {
  beat: number;
  isMeasure: boolean;
}

interface ParityHintView {
  beat: number;
  rowIndex: number;
  labels: string[];
}

interface NotefieldPreviewProps {
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
  measureGuideLayerRef: MutableRefObject<HTMLDivElement | null>;
  minimapMeasures: MinimapMeasureView[];
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
  measureGuideLayerRef,
  minimapMeasures,
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
                      style={{ top: beat * pixelsPerBeat }}
                    >
                      {isMeasure ? <span>M {beat / 4}</span> : null}
                    </div>
                  ))}

                  {visibleParityHints.map((hint) => (
                    <div key={`${hint.rowIndex}-${hint.beat}`} className="parity-hint" style={{ top: hint.beat * pixelsPerBeat }}>
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
            <p>Click or drag to seek</p>
          </div>

          <div
            className="minimap-track"
            ref={minimapRef}
            onPointerDown={handleMinimapPointerDown}
            onPointerMove={handleMinimapPointerMove}
          >
            {minimapMeasures.map((measure) => (
              <div
                key={measure.measureIndex}
                className="minimap-measure"
                style={{
                  top: `${(measure.startBeat / totalChartBeats) * 100}%`,
                  opacity: 0.18 + measure.density * 0.82,
                  transform: `scaleX(${0.35 + measure.density * 0.65})`,
                }}
              />
            ))}
            <div className="minimap-playhead" style={{ top: `${(displayBeat / totalChartBeats) * 100}%` }} />
          </div>
        </aside>
      </div>
    </section>
  );
}