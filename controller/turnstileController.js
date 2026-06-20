import { verifyTurnstileService } from "../services/turnstileService.js";

export const verifyTurnstileController = async(req, res) =>{
    const {token} = req.body;
    try {
        await verifyTurnstileService(token);
        return res.status(200).json({success: true})
    } catch (error) {
        console.error('Turnstile verification failed:', error.message, error.cloudflareErrors || []);
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || 'Server error',
            errorCodes: error.cloudflareErrors || undefined,
        })
    }
}