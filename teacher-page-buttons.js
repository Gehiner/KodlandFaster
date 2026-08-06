(() => {
    console.log("Teacher Page Buttons cargado");

    if (!location.pathname.startsWith("/teachers/")) {
        return;
    }

    console.log("Estamos en la página de un profesor");
})();

function esperarElemento(selector, callback) {
    const timer = setInterval(() => {
        const elemento = document.querySelector(selector);
        if (elemento) {
            clearInterval(timer);
            callback(elemento);
        }
    }, 500);
}
esperarElemento(".groups-header", (header) => {
    if (document.getElementById("boton-grupos")) return;
    const boton = document.createElement("button");
    boton.id="boton-grupos";
    boton.classList.add("kodland-toolbar-btn", "kodland-toolbar-btn-calificar");
    boton.textContent="✅ Calificar Todo"
    header.appendChild(boton);

    boton.addEventListener('click', async () => {
        activarModoCarga(boton, "🔄Calificando");
        try {

            const respuesta =
                await window.KodlandCalificador.ejecutar("calificar");

            console.log(respuesta);

        } catch (e) {

            console.error(e);

        }
        finally{
            desactivarModoCarga(boton,"✅ Calificar Todo");
        }
    });
});

function activarModoCarga(button, texto){
    button.disabled = true;
    button.textContent=texto;
}

function desactivarModoCarga(button, texto){
    button.disabled = false;
    button.textContent=texto;
}