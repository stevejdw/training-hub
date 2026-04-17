import { ImageResponse } from 'next/og';

export const size        = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'black',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
        }}
      >
        {/* White bike silhouette */}
        <svg viewBox="0 0 100 100" width="28" height="28">
          {/* wheels */}
          <circle cx="28" cy="66" r="19" fill="none" stroke="white" strokeWidth="5" />
          <circle cx="72" cy="66" r="19" fill="none" stroke="white" strokeWidth="5" />
          {/* chain stay */}
          <line x1="28" y1="66" x2="52" y2="66" stroke="white" strokeWidth="4.5" strokeLinecap="round" />
          {/* seat tube */}
          <line x1="52" y1="66" x2="46" y2="37" stroke="white" strokeWidth="4.5" strokeLinecap="round" />
          {/* seat stay */}
          <line x1="46" y1="37" x2="28" y2="66" stroke="white" strokeWidth="4" strokeLinecap="round" />
          {/* down tube */}
          <line x1="64" y1="40" x2="52" y2="66" stroke="white" strokeWidth="4.5" strokeLinecap="round" />
          {/* top tube */}
          <line x1="46" y1="37" x2="64" y2="40" stroke="white" strokeWidth="4" strokeLinecap="round" />
          {/* fork */}
          <line x1="64" y1="40" x2="72" y2="66" stroke="white" strokeWidth="4" strokeLinecap="round" />
          {/* handlebars */}
          <line x1="64" y1="40" x2="70" y2="32" stroke="white" strokeWidth="4" strokeLinecap="round" />
          <line x1="67" y1="32" x2="75" y2="33" stroke="white" strokeWidth="4" strokeLinecap="round" />
          {/* saddle */}
          <line x1="42" y1="35" x2="53" y2="35" stroke="white" strokeWidth="4" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
