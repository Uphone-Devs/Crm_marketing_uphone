import React from 'react';
const _EMPTY_OBJ = {};

/**
 * UPHONE Logo Component
 * Renders the official logo matching the requested design (Green U, Checkmark in O).
 * Utilizes absolute X coordinates for text to ensure the checkmark alignment is mathematically perfect across all systems.
 */
export default function Logo({ width = '180px', className = '', style = _EMPTY_OBJ, ...props }) {
  return (
    <svg 
      viewBox="0 0 350 80" 
      xmlns="http://www.w3.org/2000/svg" 
      style={{ width, height: 'auto', background: 'transparent', display: 'block', ...style }}
      className={className}
      {...props}
    >
      <g style={{ fontFamily: 'var(--font-headline), sans-serif', fontWeight: 800, fontSize: '64px', letterSpacing: '-1px' }}>
        {/* 'U' width ~45 */}
        <text x="0" y="60" fill="var(--color-primary)">U</text>
        
        {/* 'PH' width ~86 */}
        <text x="46" y="60" fill="var(--color-on-surface)">PH</text>
        
        {/* 'O' width ~46. Starts at 132. Center is 155. Ends at 178. */}
        <text x="132" y="60" fill="var(--color-on-surface)">O</text>
        
        {/* 'NE' width ~86 */}
        <text x="178" y="60" fill="var(--color-on-surface)">NE</text>
        
        {/* '®' Registration mark */}
        <text x="264" y="25" fill="var(--color-on-surface)" style={{ fontSize: '18px', fontWeight: 700 }}>®</text>
      </g>
      
      {/* 
        Checkmark perfectly aligned over the 'O'.
        Center of O is X=155, Y=37 (approx mid-height of standard cap).
        Path drops into the bottom-right and swoops out to the top-right.
      */}
      <path 
        d="M 140 42 L 152 54 L 178 22" 
        fill="none" 
        stroke="var(--color-primary)" 
        strokeWidth="7" 
        strokeLinecap="round" 
        strokeLinejoin="round" 
      />
    </svg>
  );
}
