// App-owned vectors: controls must never depend on a Windows-only icon font.
const paths={
 E700:'M4 6h16M4 12h16M4 18h16',E70D:'m5 9 7 7 7-7',E710:'M12 4v16M4 12h16',E711:'m5 5 14 14M19 5 5 19',
 E70F:'m16 4 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15z',E71A:'M5 5h14v14H5z',E71E:'M12 5v14M5 12h14',E71F:'M5 12h14',
 E723:'m9 13 7-7a3 3 0 0 1 4 4L10 20a5 5 0 0 1-7-7L13 3',E724:'m3 3 18 9-18 9 4-9-4-9zM7 12h14',E74A:'M12 20V4m-7 7 7-7 7 7',
 E72B:'M4 6h16M4 11h10M4 16h6M17 14v8M13 18h8',E774:'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
 E740:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',E73F:'M3 8h5V3M16 3v5h5M8 21v-5H3M21 16h-5v5',E81E:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 12h8M12 8v8',
 E74D:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',E75C:'m4 15 9-11 7 6-9 11H8l-4-6zM9 10l7 6M4 21h17',
 E76B:'m15 5-7 7 7 7',E76C:'m9 5 7 7-7 7',E777:'M9 3 3 9l6 6M3 9h11a7 7 0 0 1 0 14',
 E7A7:'M9 4 3 10l6 6M3 10h11a7 7 0 0 1 0 14',E7A6:'m15 4 6 6-6 6M21 10H10a7 7 0 0 0 0 14',E7B8:'M3 4h18v5H3zM5 9v12h14V9M9 13h6',
 E81C:'M3 10a9 9 0 1 1 2.6 8M3 4v6h6M12 7v5l3 2',E792:'M12 16V3m-4 4 4-4 4 4M5 12v8h14v-8',
 E8FD:'M3 5h2M9 5h12M3 12h2M9 12h12M3 19h2M9 19h12',E8F2:'M3 4h18v13H9l-6 4V4zM7 8h10M7 12h7',
 E8A5:'M14 3H5v18h14V8l-5-5v5h5M8 12h8M8 16h6',E70A:'M3 4h18v14H3zM8 22l4-4 4 4M7 8h4v5H7M15 8h2M15 12h2',
 E8C8:'M9 8h12v13H9zM5 16H3V3h12v2',E8B7:'M3 6h7l2 2h9v12H3z',E82D:'M12 5v16M12 5C8 2 4 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-2-1-6-2-10 1',
 E823:'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0M12 6v6l4 2',E768:'m6 3 15 9-15 9z',E769:'M7 4v16M17 4v16',
 E8D3:'m5 18 7-15 7 15M8 12h8M3 22h18',E7E6:'m7 14 9-11 5 4-9 11-5-4zM7 14l-4 6h8M3 23h18'
};
export const uiGlyphCodes=Object.freeze(Object.keys(paths));
export function uiGlyph(value,className='note-legacy-icon'){
 const code=/^[EF][0-9A-F]{3}$/.test(value)?value:String(value).codePointAt(0)?.toString(16).toUpperCase(),path=paths[code];
 if(!path)throw Error('Missing application icon: '+code);
 if(!/^[a-zA-Z0-9 _-]+$/.test(className))throw Error('Invalid icon class');
 return `<span class="${className}" data-ui-glyph="${code}" aria-hidden="true"><svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="${path}"/></svg></span>`;
}
