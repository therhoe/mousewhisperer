import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useState } from "react";
import "./RichTextEditor.css";

interface RichTextEditorProps {
  name: string;
  placeholder?: string;
  initialContent?: string;
}

export function RichTextEditor({
  name,
  placeholder = "Write something...",
  initialContent = "",
}: RichTextEditorProps) {
  const [mounted, setMounted] = useState(false);
  const hiddenRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      if (hiddenRef.current) {
        hiddenRef.current.value = editor.getHTML();
      }
    },
    immediatelyRender: false,
  });

  const addLink = () => {
    if (!editor) return;

    // If link is already active, unset it
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    // Save current selection before prompt steals focus
    const { from, to, empty } = editor.state.selection;
    const selectedText = empty ? "" : editor.state.doc.textBetween(from, to);

    const url = window.prompt("URL");
    if (!url) return;

    // Ensure URL has a protocol
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;

    // Restore focus to the editor
    editor.chain().focus().run();

    if (selectedText) {
      // Text was selected — apply link to selection
      editor.chain().focus().setLink({ href }).run();
    } else {
      // No selection — insert the URL as linked text
      editor
        .chain()
        .focus()
        .insertContent(`<a href="${href}">${url}</a>`)
        .run();
    }
  };

  if (!mounted) {
    return (
      <div className="rte-wrapper">
        <div className="rte-toolbar" />
        <div className="rte-editor" style={{ minHeight: 150, padding: 12, color: "var(--p-color-text-secondary)" }}>
          {placeholder}
        </div>
        <input type="hidden" name={name} value={initialContent} />
      </div>
    );
  }

  return (
    <div className="rte-wrapper">
      <input type="hidden" name={name} ref={hiddenRef} defaultValue={initialContent} />
      {editor && (
        <div className="rte-toolbar">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive("bold") ? "is-active" : ""}
          >
            <b>B</b>
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive("italic") ? "is-active" : ""}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={editor.isActive("bulletList") ? "is-active" : ""}
          >
            • List
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={editor.isActive("orderedList") ? "is-active" : ""}
          >
            1. List
          </button>
          <button type="button" onClick={addLink} className={editor.isActive("link") ? "is-active" : ""}>
            Link
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={editor.isActive("codeBlock") ? "is-active" : ""}
          >
            Code
          </button>
        </div>
      )}
      <div className="rte-editor">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
