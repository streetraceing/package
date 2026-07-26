import type { ShiftInstruction } from '../types.js';

function quote(value: string): string {
  return JSON.stringify(value);
}

export function renderShift(instructions: ShiftInstruction[]): string {
  const lines = ['PACKAGESHIFT 1', ''];
  for (const instruction of instructions) {
    if (instruction.type === 'MESSAGE') lines.push(`MESSAGE ${quote(instruction.value)}`);
    else if (instruction.type === 'BASE') lines.push(`BASE ${instruction.hash}`);
    else if (instruction.type === 'REMOVE') lines.push(`REMOVE ${quote(instruction.path)}${instruction.expectedHash ? ` IF ${instruction.expectedHash}` : ''}`);
    else if (instruction.type === 'MOVE') lines.push(`MOVE ${quote(instruction.from)} TO ${quote(instruction.to)}${instruction.expectedHash ? ` IF ${instruction.expectedHash}` : ''}`);
    else if (instruction.type === 'COPY') lines.push(`COPY ${quote(instruction.from)} TO ${quote(instruction.to)}`);
    else if (instruction.type === 'REPLACE') lines.push(`REPLACE ${quote(instruction.path)}${instruction.expectedHash ? ` IF ${instruction.expectedHash}` : ''}`);
    else if (instruction.type === 'CHMOD') lines.push(`CHMOD ${quote(instruction.path)} ${instruction.mode.toString(8)}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
