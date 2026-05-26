import { randomBytes } from 'crypto';

export function randomString(length = 8): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

export function randomEmail(): string {
  return `test_${randomString(8)}@mailinator.com`;
}

export function randomName(): string {
  const first = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank'];
  const last = ['Smith', 'Jones', 'Brown', 'White', 'Black', 'Green', 'Hall', 'Wood'];
  return `${first[Math.floor(Math.random() * first.length)]} ${last[Math.floor(Math.random() * last.length)]}`;
}

export function randomPassword(): string {
  return `Pwd_${randomString(10)}!`;
}
