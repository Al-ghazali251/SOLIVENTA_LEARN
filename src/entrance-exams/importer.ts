import { z } from 'zod';

export const ImportedQuestionSchema = z.object({
  kind: z.enum(['single_choice','multiple_choice','true_false','short_text','long_text','number']),
  prompt: z.string().trim().min(1).max(10000), options: z.array(z.string().min(1).max(2000)).max(20).optional(),
  correctAnswer: z.unknown().optional(), marks: z.number().positive().max(1000).default(1), explanation: z.string().max(5000).optional(),
});
export type ImportedQuestion = z.infer<typeof ImportedQuestionSchema>;

const QuestionListSchema = z.array(ImportedQuestionSchema).min(1);

function scalar(value: string): unknown {
  const clean=value.trim().replace(/^['"]|['"]$/g,'');
  if (clean==='true') return true; if(clean==='false') return false; if(/^[-+]?\d+(\.\d+)?$/.test(clean)) return Number(clean);
  if(clean.startsWith('[')) try{return JSON.parse(clean);}catch{return clean;}
  return clean;
}

export function importEntranceQuestions(source: string, format: 'markdown'|'yaml'): ImportedQuestion[] {
  if (source.length > 500_000) throw new Error('Import document is too large.');
  if (!source.trim()) throw new Error('No questions were found. Use "## Question" headings or YAML question list items.');
  if (format === 'yaml') return importYamlQuestions(source);
  const blocks = format === 'markdown'
    ? source.split(/^##+\s+(?:Question\s*\d*[:.-]?\s*)?/gmi).slice(1)
    : [];
  const questions = blocks.map((block) => {
    const lines=block.split(/\r?\n/); const record: Record<string,unknown>={}; const options:string[]=[]; const correct:number[]=[];
    let prompt='';
    for(const raw of lines){const line=raw.trim(); if(!line) continue;
      const meta=line.match(/^(kind|type|prompt|marks|correctAnswer|correct|answer|explanation)\s*:\s*(.+)$/i);
      if(meta){const key=meta[1]!.toLowerCase(), value=scalar(meta[2]!); if(key==='prompt') prompt=String(value); else if(key==='type') record.kind=value; else if(key==='correctanswer'||key==='correct'||key==='answer') record.correctAnswer=value; else record[key]=value; continue;}
      const option=line.match(/^[-*]\s*(?:\[([ xX])\]\s*)?(.+)$/); if(option){options.push(option[2]!.trim()); if(option[1]?.toLowerCase()==='x') correct.push(options.length-1); continue;}
      if(!prompt) prompt=line.replace(/^prompt\s*:\s*/i,''); else if(!record.kind) prompt += `\n${line}`;
    }
    if(options.length){record.options=options;if(record.correctAnswer===undefined&&correct.length) record.correctAnswer=correct.length===1?correct[0]:correct;}
    return ImportedQuestionSchema.parse({kind:options.length?'single_choice':'short_text',marks:1,prompt,...record});
  });
  if(!questions.length) throw new Error('No questions were found. Use "## Question" headings or YAML question list items.');
  return questions;
}

function importYamlQuestions(source: string): ImportedQuestion[] {
  const blocks = source.split(/^(?=\s*-\s+(?:prompt|kind|type)\s*:)/gmi).filter((block) => block.trim());
  const questions = blocks.map((block) => {
    const record: Record<string, unknown> = {};
    const options: string[] = [];
    let listKey: 'options'|'correctAnswer'|undefined;
    for (const raw of block.split(/\r?\n/)) {
      const line = raw.trim().replace(/^-\s+(?=(?:prompt|kind|type)\s*:)/i, '');
      if (!line) continue;
      const property = line.match(/^(kind|type|prompt|marks|correctAnswer|correct|answer|explanation|options)\s*:\s*(.*)$/i);
      if (property) {
        const rawKey = property[1]!.toLowerCase();
        const key = rawKey === 'type' ? 'kind' : rawKey === 'correctanswer' || rawKey === 'correct' || rawKey === 'answer' ? 'correctAnswer' : rawKey;
        const value = property[2]!.trim();
        listKey = key === 'options' || key === 'correctAnswer' ? key : undefined;
        if (value) record[key] = scalar(value);
        continue;
      }
      const item = line.match(/^[-*]\s+(.+)$/);
      if (item && listKey === 'options') options.push(String(scalar(item[1]!)));
      else if (item && listKey === 'correctAnswer') {
        const answers = Array.isArray(record.correctAnswer) ? record.correctAnswer : [];
        record.correctAnswer = [...answers, scalar(item[1]!)];
      }
    }
    if (options.length) record.options = options;
    if (!record.kind) record.kind = options.length ? 'single_choice' : 'short_text';
    return ImportedQuestionSchema.parse(record);
  });
  if (!questions.length) throw new Error('No questions were found. Use "## Question" headings or YAML question list items.');
  return QuestionListSchema.parse(questions);
}
