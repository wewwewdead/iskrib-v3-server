import { getInterestSectionsService } from "../services/exploreInterestsService.js";

export const getInterestSectionsController = async (req, res) => {
    const userId = req.userId;

    try {
        const data = await getInterestSectionsService(userId);
        return res.status(200).json(data);
    } catch (error) {
        console.error(error);
        const status = error?.status || 500;
        return res.status(status).json({ error: error?.error || 'failed to fetch interest sections' });
    }
};
