(function(){
  const planInput = document.querySelector("#selected-plan");
  const continueBtn = document.querySelector("#continue-btn");

  const columns = {
    core: document.querySelectorAll("[data-plan-col='core']"),
    pro: document.querySelectorAll("[data-plan-col='pro']"),
    enterprise: document.querySelectorAll("[data-plan-col='enterprise']")
  };

  function clearSelection(){
    Object.values(columns).forEach(col =>
      col.forEach(el => el.classList.remove("selected-col"))
    );
  }

  function setSelected(plan){
    clearSelection();
    columns[plan]?.forEach(el => el.classList.add("selected-col"));
    planInput.value = plan;
    continueBtn.disabled = !plan;
    continueBtn.textContent = `Continue with ${plan.charAt(0).toUpperCase() + plan.slice(1)}`;
  }

  Object.entries(columns).forEach(([plan, els]) => {
    els.forEach(el => {
      el.addEventListener("click", () => setSelected(plan));
    });
  });

  const params = new URLSearchParams(location.search);
  const pre = params.get("plan");
  if(pre) setSelected(pre);
})();
