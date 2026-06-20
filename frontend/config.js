window.GEORISK_CONFIG = {
  /* 
    Para desplegar frontend en Vercel + backend en Render:
    API_BASE: se mantiene como `${location.origin}/api` porque Vercel 
    redirige /api/* a Render mediante vercel.json

    SSE_BASE: SSE (EventSource) no funciona a través del proxy de Vercel 
    porque tiene timeout. Cámbialo a la URL directa de tu backend en Render:
    Ejemplo: "https://georisk-api.onrender.com/api"
  */
  SSE_BASE: null, // null = usa el mismo que API_BASE (${location.origin}/api)
};
