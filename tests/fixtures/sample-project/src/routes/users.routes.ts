import { authenticate } from '../auth/index.js';
import { getUserById, createUser } from '../db/index.js';

export const userRoutes = {
  getUser: [authenticate, async (req: any, res: any) => {
    const user = await getUserById(req.params.id);
    res.json(user);
  }],
  createUser: [authenticate, async (req: any, res: any) => {
    const user = await createUser(req.body);
    res.json(user);
  }],
};
