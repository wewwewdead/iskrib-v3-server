import { verfifyTurnstileService } from "../services/turnstileService.js";

export const verfifyTurnstileController = async(req, res) =>{
    const {token} = req.body;
    try {
        await verfifyTurnstileService(token);
        return res.status(200).json({success: true})
    } catch (error) {
        console.error(error);
        return res.status(error.status || 500).json({success: false, message: 'Server error'})
    }
}