import type { CSSProperties, MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { Panel, TimedNoteEvent } from '../lib/simfile';

interface HoldSegmentView {
  panel: Panel;
  startBeat: number;
  endBeat: number;
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

interface NotefieldPreviewProps {
  chartDifficultyLabel: string;
  chartEventCount: number;
  chartOffsetSeconds: number;
  chartContentHeight: number;
  displayBeat: number;
  explosionRefs: MutableRefObject<Record<Panel, HTMLDivElement | null>>;
  getNoteDetailStyle: (event: TimedNoteEvent) => CSSProperties | null;
  getHoldStyle: (segment: HoldSegmentView) => CSSProperties;
  getNoteFrameStyle: (event: TimedNoteEvent) => CSSProperties;
  getNoteStyle: (event: TimedNoteEvent) => CSSProperties;
  getNoteUnderlayStyle: (event: TimedNoteEvent) => CSSProperties | null;
  getReceptorStyle: (panel: Panel) => CSSProperties;
  handleMinimapPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleMinimapPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  isPlaying: boolean;
  minimapMeasures: MinimapMeasureView[];
  minimapRef: MutableRefObject<HTMLDivElement | null>;
  notefieldFrameRef: MutableRefObject<HTMLDivElement | null>;
  panelOrder: readonly Panel[];
  pixelsPerBeat: number;
  playfieldStyle: CSSProperties;
  receptorOffset: number;
  receptorRefs: MutableRefObject<Record<Panel, HTMLDivElement | null>>;
  scrollLayerRef: MutableRefObject<HTMLDivElement | null>;
  totalChartBeats: number;
  viewportHeight: number;
  visibleBeatGuides: BeatGuide[];
  visibleEvents: TimedNoteEvent[];
  visibleHolds: HoldSegmentView[];
  botWindow: ReactNode;
}

export function NotefieldPreview({
  chartDifficultyLabel,
  chartEventCount,
  chartOffsetSeconds,
  chartContentHeight,
  displayBeat,
  explosionRefs,
  getNoteDetailStyle,
  getHoldStyle,
  getNoteFrameStyle,
  getNoteStyle,
  getNoteUnderlayStyle,
  getReceptorStyle,
  handleMinimapPointerDown,
  handleMinimapPointerMove,
  isPlaying,
  minimapMeasures,
  minimapRef,
  notefieldFrameRef,
  panelOrder,
  pixelsPerBeat,
  playfieldStyle,
  receptorOffset,
  receptorRefs,
  scrollLayerRef,
  totalChartBeats,
  viewportHeight,
  visibleBeatGuides,
  visibleEvents,
  visibleHolds,
  botWindow,
}: NotefieldPreviewProps) {
  return (
    <section className="notefield-panel" aria-label="Interactive notefield preview">
      <div className="notefield-header">
        <div className="notefield-status" aria-label="Playback status">
          <span>{isPlaying ? 'Playing' : 'Paused'}</span>
          <span>{chartEventCount} events</span>
          <span>{chartDifficultyLabel}</span>
          <span>{chartOffsetSeconds.toFixed(3)}s offset</span>
        </div>

        <p className="notefield-caption">Space toggles playback. Scroll scrubs anywhere on the page. Ctrl + scroll changes note spacing everywhere except form controls.</p>
      </div>

      <div className="notefield-layout">
        <div className="notefield-frame" ref={notefieldFrameRef}>
          <div className="notefield-playfield" style={playfieldStyle}>
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
              <div className="chart-scroll-layer" ref={scrollLayerRef} style={{ height: chartContentHeight }}>
                {visibleBeatGuides.map(({ beat, isMeasure }) => (
                  <div
                    key={beat}
                    className={`measure-guide${isMeasure ? ' measure-guide-major' : ' measure-guide-minor'}`}
                    style={{ top: beat * pixelsPerBeat }}
                  >
                    {isMeasure ? <span>Measure {beat / 4 + 1}</span> : null}
                  </div>
                ))}

                {panelOrder.map((panel) => (
                  <div key={panel} className="lane-column" data-panel={panel} style={{ height: chartContentHeight }}>
                    {visibleHolds
                      .filter((segment) => segment.panel === panel)
                      .map((segment) => (
                        <div
                          key={`${segment.panel}-${segment.startBeat}-${segment.endBeat}`}
                          className="hold-body"
                          style={getHoldStyle(segment)}
                        />
                      ))}

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