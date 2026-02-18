// /static/js/activate.js
(function(){
  const tiles = Array.from(document.querySelectorAll("[data-plan-tile]"));
  const planInput = document.querySelector("#selected-plan");
  const continueBtn = document.querySelector("#continue-btn");

  function setSelected(plan){
    tiles.forEach(t => t.classList.toggle("selected", t.dataset.plan === plan));
    planInput.value = plan;
    continueBtn.disabled = !plan;
  }

  tiles.forEach(tile => {
    tile.addEventListener("click", () => setSelected(tile.dataset.plan));
    tile.addEventListener("keydown", (e) => {
      if(e.key === "Enter" || e.key === " "){
        e.preventDefault();
        setSelected(tile.dataset.plan);
      }
    });
  });

  // Preselect if URL has ?plan=
  const params = new URLSearchParams(location.search);
  const pre = params.get("plan");
  if(pre) setSelected(pre);
})();
