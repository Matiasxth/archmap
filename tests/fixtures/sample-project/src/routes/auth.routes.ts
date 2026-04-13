import { signToken } from '../auth/index.js';
import { getUserById } from '../db/index.js';

export const authRoutes = {
  login: async (req: any, res: any) => {
    const user = await getUserById(req.body.userId);
    const token = signToken({ userId: user.id, role: user.role });
    res.json({ token });
  },
};
