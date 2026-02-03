"""
Email service using Resend for transactional emails.
"""
import os
import logging
import random
import resend

logger = logging.getLogger("uvicorn.error")

# Configure Resend
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
FROM_EMAIL = "CRITERIO <noreply@criterio.trade>"

resend.api_key = RESEND_API_KEY


def generate_verification_code() -> str:
    """Generate a 6-digit verification code."""
    return str(random.randint(100000, 999999))


def send_verification_email(to_email: str, code: str, lang: str = "es") -> bool:
    """
    Send email verification code to user.
    Returns True if sent successfully, False otherwise.
    """
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not configured, skipping email")
        return False

    if lang == "es":
        subject = f"{code} es tu codigo de verificacion"
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color:#f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:8px; overflow:hidden;">
                    <tr>
                        <td style="padding:32px 40px; text-align:center;">
                            <h1 style="margin:0 0 8px 0; font-size:24px; font-weight:700; color:#1a1a1a; letter-spacing:2px;">CRITERIO</h1>
                            <p style="margin:0; font-size:14px; color:#666;">Crypto Trading Intelligence</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 40px 32px 40px;">
                            <p style="margin:0 0 24px 0; font-size:16px; color:#333; line-height:1.5;">
                                Tu codigo de verificacion es:
                            </p>
                            <div style="background-color:#f8f9fa; border-radius:8px; padding:24px; text-align:center; margin-bottom:24px;">
                                <span style="font-size:32px; font-weight:700; letter-spacing:6px; color:#1a1a1a; font-family:monospace;">{code}</span>
                            </div>
                            <p style="margin:0 0 8px 0; font-size:14px; color:#666; line-height:1.5;">
                                Ingresa este codigo en la app para verificar tu email.
                            </p>
                            <p style="margin:0; font-size:14px; color:#999;">
                                El codigo expira en 24 horas.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:24px 40px; background-color:#f8f9fa; border-top:1px solid #eee;">
                            <p style="margin:0; font-size:12px; color:#999; text-align:center;">
                                Si no creaste una cuenta en CRITERIO, ignora este email.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""
        text_content = f"""CRITERIO - Crypto Trading Intelligence

Tu codigo de verificacion es: {code}

Ingresa este codigo en la app para verificar tu email.
El codigo expira en 24 horas.

Si no creaste una cuenta en CRITERIO, ignora este email.
"""
    else:
        subject = f"{code} is your verification code"
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color:#f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:8px; overflow:hidden;">
                    <tr>
                        <td style="padding:32px 40px; text-align:center;">
                            <h1 style="margin:0 0 8px 0; font-size:24px; font-weight:700; color:#1a1a1a; letter-spacing:2px;">CRITERIO</h1>
                            <p style="margin:0; font-size:14px; color:#666;">Crypto Trading Intelligence</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 40px 32px 40px;">
                            <p style="margin:0 0 24px 0; font-size:16px; color:#333; line-height:1.5;">
                                Your verification code is:
                            </p>
                            <div style="background-color:#f8f9fa; border-radius:8px; padding:24px; text-align:center; margin-bottom:24px;">
                                <span style="font-size:32px; font-weight:700; letter-spacing:6px; color:#1a1a1a; font-family:monospace;">{code}</span>
                            </div>
                            <p style="margin:0 0 8px 0; font-size:14px; color:#666; line-height:1.5;">
                                Enter this code in the app to verify your email.
                            </p>
                            <p style="margin:0; font-size:14px; color:#999;">
                                This code expires in 24 hours.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:24px 40px; background-color:#f8f9fa; border-top:1px solid #eee;">
                            <p style="margin:0; font-size:12px; color:#999; text-align:center;">
                                If you didn't create a CRITERIO account, please ignore this email.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""
        text_content = f"""CRITERIO - Crypto Trading Intelligence

Your verification code is: {code}

Enter this code in the app to verify your email.
This code expires in 24 hours.

If you didn't create a CRITERIO account, please ignore this email.
"""

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [to_email],
            "subject": subject,
            "html": html_content,
            "text": text_content,  # Plain text version helps avoid spam
        }
        response = resend.Emails.send(params)
        logger.info(f"Verification email sent to {to_email}: {response}")
        return True
    except Exception as e:
        logger.error(f"Failed to send verification email to {to_email}: {e}")
        return False


def send_password_reset_email(to_email: str, code: str, lang: str = "es") -> bool:
    """
    Send password reset code to user.
    Returns True if sent successfully, False otherwise.
    """
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not configured, skipping email")
        return False

    if lang == "es":
        subject = f"{code} - Restablecer contrasena"
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color:#f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:8px; overflow:hidden;">
                    <tr>
                        <td style="padding:32px 40px; text-align:center;">
                            <h1 style="margin:0 0 8px 0; font-size:24px; font-weight:700; color:#1a1a1a; letter-spacing:2px;">CRITERIO</h1>
                            <p style="margin:0; font-size:14px; color:#666;">Crypto Trading Intelligence</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 40px 32px 40px;">
                            <p style="margin:0 0 24px 0; font-size:16px; color:#333; line-height:1.5;">
                                Tu codigo para restablecer la contrasena es:
                            </p>
                            <div style="background-color:#f8f9fa; border-radius:8px; padding:24px; text-align:center; margin-bottom:24px;">
                                <span style="font-size:32px; font-weight:700; letter-spacing:6px; color:#1a1a1a; font-family:monospace;">{code}</span>
                            </div>
                            <p style="margin:0 0 8px 0; font-size:14px; color:#666; line-height:1.5;">
                                Ingresa este codigo en la app para crear una nueva contrasena.
                            </p>
                            <p style="margin:0; font-size:14px; color:#999;">
                                El codigo expira en 1 hora.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:24px 40px; background-color:#f8f9fa; border-top:1px solid #eee;">
                            <p style="margin:0; font-size:12px; color:#999; text-align:center;">
                                Si no solicitaste restablecer tu contrasena, ignora este email.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""
        text_content = f"""CRITERIO - Crypto Trading Intelligence

Tu codigo para restablecer la contrasena es: {code}

Ingresa este codigo en la app para crear una nueva contrasena.
El codigo expira en 1 hora.

Si no solicitaste restablecer tu contrasena, ignora este email.
"""
    else:
        subject = f"{code} - Reset your password"
        html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color:#f5f5f5;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5; padding:40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#ffffff; border-radius:8px; overflow:hidden;">
                    <tr>
                        <td style="padding:32px 40px; text-align:center;">
                            <h1 style="margin:0 0 8px 0; font-size:24px; font-weight:700; color:#1a1a1a; letter-spacing:2px;">CRITERIO</h1>
                            <p style="margin:0; font-size:14px; color:#666;">Crypto Trading Intelligence</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 40px 32px 40px;">
                            <p style="margin:0 0 24px 0; font-size:16px; color:#333; line-height:1.5;">
                                Your password reset code is:
                            </p>
                            <div style="background-color:#f8f9fa; border-radius:8px; padding:24px; text-align:center; margin-bottom:24px;">
                                <span style="font-size:32px; font-weight:700; letter-spacing:6px; color:#1a1a1a; font-family:monospace;">{code}</span>
                            </div>
                            <p style="margin:0 0 8px 0; font-size:14px; color:#666; line-height:1.5;">
                                Enter this code in the app to create a new password.
                            </p>
                            <p style="margin:0; font-size:14px; color:#999;">
                                This code expires in 1 hour.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:24px 40px; background-color:#f8f9fa; border-top:1px solid #eee;">
                            <p style="margin:0; font-size:12px; color:#999; text-align:center;">
                                If you didn't request a password reset, please ignore this email.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
"""
        text_content = f"""CRITERIO - Crypto Trading Intelligence

Your password reset code is: {code}

Enter this code in the app to create a new password.
This code expires in 1 hour.

If you didn't request a password reset, please ignore this email.
"""

    try:
        params = {
            "from": FROM_EMAIL,
            "to": [to_email],
            "subject": subject,
            "html": html_content,
            "text": text_content,
        }
        response = resend.Emails.send(params)
        logger.info(f"Password reset email sent to {to_email}: {response}")
        return True
    except Exception as e:
        logger.error(f"Failed to send password reset email to {to_email}: {e}")
        return False
