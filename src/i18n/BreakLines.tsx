import { Fragment } from 'react';

/** 句読点であらかじめ区切られた行の配列を、<br/> 区切りで描画する */
export function BreakLines({ lines }: { lines: readonly string[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {line}
          {i < lines.length - 1 && <br />}
        </Fragment>
      ))}
    </>
  );
}
