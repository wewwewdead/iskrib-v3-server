
export const verfifyTurnstileService = async(token) =>{
    if(!token) {
        throw {status: 400, message: 'No token provided'}
    }

    const secretKey = process.env.SECRET_KEY;

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
            method: 'POST',
            headers: {"Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                secret: secretKey,
                response: token,
            })
        })

        const data = await response.json();

        if(!data.success){
            throw {status: 400, message: 'Verification failed'}
        }

        return true;
}