export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: Date;
}

export type CreateUserDTO = Pick<User, 'name' | 'email'>;
