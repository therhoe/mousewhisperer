interface RichTextDisplayProps {
  html: string;
}

export function RichTextDisplay({ html }: RichTextDisplayProps) {
  return (
    <div
      className="rte-editor"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ fontSize: 14, lineHeight: 1.6 }}
    />
  );
}
