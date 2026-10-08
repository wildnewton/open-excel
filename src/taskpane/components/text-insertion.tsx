/* global Excel */
import type { FC } from "react";
import { useState } from "react";

async function insertText(text: string) {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getActiveWorksheet();
    const range = sheet.getRange("A1");
    range.values = [[text]];
    range.format.autofitColumns();
    await context.sync();
  });
}

const TextInsertion: FC = () => {
  const [text, setText] = useState("Some text.");

  return (
    <div className="flex flex-col items-center p-4 gap-4">
      <label className="w-full max-w-xs block">
        <span className="block text-sm mb-1">Text to insert:</span>
        <textarea
          className="w-full p-2 border rounded resize-none"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        onClick={() => insertText(text)}
      >
        Insert text
      </button>
    </div>
  );
};

export default TextInsertion;
