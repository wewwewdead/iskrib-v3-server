import { getUserDataService } from "../services/getUserDataService.js";

export const getUserDataController = async(req, res) =>{
    const {userId} = req.query;

    try {
        const data = await getUserDataService(userId);
        return res.status(200).json(data)
    } catch (error) {
        console.error(error);
        return res.status(500).json({error: 'error fetching user data'})
    }
}