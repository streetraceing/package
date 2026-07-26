import { matchesGlob } from './ignore.js';

const sensitivePatterns = [
  '.env',
  '.env.*',
  '**/.env',
  '**/.env.*',
  '*.pem',
  '*.key',
  '**/*.pem',
  '**/*.key',
  'id_rsa',
  '**/id_rsa',
  '.npmrc',
  '**/.npmrc',
  '.pypirc',
  '**/.pypirc',
];

export function findSensitiveFiles(paths: string[]): string[] {
  return paths.filter((filePath) =>
    sensitivePatterns.some((pattern) => matchesGlob(filePath, pattern)),
  );
}
