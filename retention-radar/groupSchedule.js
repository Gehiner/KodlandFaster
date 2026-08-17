async function obtenerCalendarioGrupo(groupId) {

    console.log("📅 Entré a obtenerCalendarioGrupo:", groupId);

    try {

        const apiUrl =
            `https://backoffice.kodland.org/api/v2/student_groups/${groupId}/schedule_view/`;

        console.log("🌐 URL:", apiUrl);

        console.log("🔐 authToken disponible:", !!authToken);
        console.log("🔐 Longitud del token:", authToken?.length);

        const response = await fetch(apiUrl, {
            method: "GET",
            credentials: "include",
            headers: {
                "Accept": "application/json",
                "Authorization": `Bearer ${authToken}`
            }
        });

        console.log("📡 Status:", response.status);
        console.log(
            "📦 Content-Type:",
            response.headers.get("content-type")
        );

        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }

        const datos = await response.json();

        console.log("📅 Calendario recibido:", datos);
        console.log("📚 Cantidad de clases:", datos.length);

        return datos;

    } catch (error) {

        console.error(
            "❌ Error obteniendo calendario del grupo:",
            error
        );

    }
}

obtenerCalendarioGrupo(66479);